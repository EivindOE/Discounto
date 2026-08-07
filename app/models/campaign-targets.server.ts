import type {
  SelectedCollectionInput,
  SelectedProductInput,
} from "./discount.server";

// Keep this query as cheap as possible. Shopify prices a connection up front as
// `first` x (cost of each node), so every extra object field costs 250 points on
// its own. Only the id/handle are consumed downstream, so no nested objects here.
// Use `collection(id:)` rather than `node(id:)`. The generic `node` field
// returns null both for "does not exist" and for "your app may not read this",
// with no error either way - which is what made a permission problem look like
// an empty collection.
const COLLECTION_PRODUCTS_QUERY = `#graphql
  query DiscountoCollectionProducts($id: ID!, $after: String) {
    collection(id: $id) {
      id
      title
      handle
      products(first: 250, after: $after) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          id
          title
          handle
        }
      }
    }
  }
`;

const GRANTED_SCOPES_QUERY = `#graphql
  query DiscountoGrantedScopes {
    currentAppInstallation {
      accessScopes {
        handle
      }
    }
  }
`;

// A stored collection id goes stale as soon as the merchant deletes and
// recreates a collection. The handle survives that, so use it to recover.
const COLLECTION_ID_BY_HANDLE_QUERY = `#graphql
  query DiscountoCollectionIdByHandle($query: String!) {
    collections(first: 1, query: $query) {
      nodes {
        id
        handle
      }
    }
  }
`;

// Newest first - a stale id is usually one the merchant just replaced, so the
// replacement is far more useful here than the ten oldest collections.
const COLLECTION_SAMPLE_QUERY = `#graphql
  query DiscountoCollectionSample {
    collections(first: 10, sortKey: ID, reverse: true) {
      nodes {
        id
        handle
      }
    }
  }
`;

const THROTTLE_MAX_ATTEMPTS = 5;
const THROTTLE_MAX_WAIT_MS = 10_000;

export type AdminGraphqlClient = {
  graphql: (
    query: string,
    options?: {
      variables?: Record<string, unknown>;
    },
  ) => Promise<Response>;
};

export type EffectiveProductTarget = {
  productGid: string;
  productTitle?: string | null;
  productHandle?: string | null;
  imageUrl?: string | null;
};

/**
 * Request-scoped memo of collection membership. Resolving the same collection
 * twice in one request is what used to blow the Shopify cost budget, so callers
 * that touch coverage more than once must share a cache.
 */
export type CollectionResolutionCache = Map<string, Promise<EffectiveProductTarget[]>>;

export function createCollectionResolutionCache(): CollectionResolutionCache {
  return new Map();
}

type CollectionNode = {
  id?: string | null;
  title?: string | null;
  handle?: string | null;
  products?: {
    pageInfo?: {
      hasNextPage?: boolean | null;
      endCursor?: string | null;
    } | null;
    nodes?: Array<{
      id?: string | null;
      title?: string | null;
      handle?: string | null;
    }>;
  } | null;
} | null;

type GraphqlCostExtensions = {
  cost?: {
    requestedQueryCost?: number | null;
    throttleStatus?: {
      maximumAvailable?: number | null;
      currentlyAvailable?: number | null;
      restoreRate?: number | null;
    } | null;
  } | null;
};

type CollectionProductsResponse = {
  errors?: Array<{
    message?: string | null;
    extensions?: { code?: string | null } | null;
  }>;
  extensions?: GraphqlCostExtensions | null;
  data?: { collection?: CollectionNode };
};

export type CampaignTargetSnapshot = {
  id: string;
  status: "ACTIVE" | "DRAFT" | "ARCHIVED";
  products: Array<{ productGid: string }>;
  collections: Array<{ collectionGid: string }>;
};

function normalizeProducts(
  products: Array<
    | SelectedProductInput
    | EffectiveProductTarget
    | { productGid: string }
    | null
    | undefined
  >,
) {
  const byId = new Map<string, EffectiveProductTarget>();

  for (const product of products) {
    if (!product) {
      continue;
    }

    const productGid =
      typeof product.productGid === "string" ? product.productGid.trim() : "";

    if (!productGid) {
      continue;
    }

    if (!byId.has(productGid)) {
      byId.set(productGid, {
        productGid,
        productTitle: "productTitle" in product ? product.productTitle ?? null : null,
        productHandle: "productHandle" in product ? product.productHandle ?? null : null,
        imageUrl: "imageUrl" in product ? product.imageUrl ?? null : null,
      });
    }
  }

  return [...byId.values()];
}

/**
 * Keeps the handle alongside the id: the id is what we stored, the handle is
 * what still works after a collection has been deleted and recreated.
 */
function collectUniqueCollectionTargets(
  collections: Array<
    SelectedCollectionInput | { collectionGid: string } | null | undefined
  >,
) {
  const targets: Array<{ collectionGid: string; collectionHandle: string | null }> = [];
  const seen = new Set<string>();

  for (const collection of collections) {
    const collectionGid = collection?.collectionGid?.trim();

    if (!collectionGid || seen.has(collectionGid)) {
      continue;
    }

    seen.add(collectionGid);
    targets.push({
      collectionGid,
      collectionHandle:
        collection && "collectionHandle" in collection
          ? collection.collectionHandle ?? null
          : null,
    });
  }

  return targets;
}

function isThrottledResponse(json: CollectionProductsResponse) {
  return (
    json.errors?.some(
      (error) =>
        error?.extensions?.code === "THROTTLED" ||
        /throttl/i.test(error?.message ?? ""),
    ) ?? false
  );
}

/**
 * Shopify tells us exactly how many points we are short and how fast the bucket
 * refills, so wait for the real deficit instead of a blind backoff.
 */
function getThrottleWaitMs(json: CollectionProductsResponse, attempt: number) {
  const cost = json.extensions?.cost;
  const restoreRate = cost?.throttleStatus?.restoreRate ?? 0;
  const currentlyAvailable = cost?.throttleStatus?.currentlyAvailable ?? 0;
  const requestedQueryCost = cost?.requestedQueryCost ?? 0;

  if (restoreRate > 0 && requestedQueryCost > currentlyAvailable) {
    const deficit = requestedQueryCost - currentlyAvailable;
    return Math.min(Math.ceil((deficit / restoreRate) * 1000) + 100, THROTTLE_MAX_WAIT_MS);
  }

  return Math.min(500 * 2 ** attempt, THROTTLE_MAX_WAIT_MS);
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchCollectionProductsPage({
  admin,
  collectionGid,
  after,
}: {
  admin: AdminGraphqlClient;
  collectionGid: string;
  after?: string | null;
}) {
  let lastThrottleMessage = "Throttled by the Shopify Admin API.";

  for (let attempt = 0; attempt < THROTTLE_MAX_ATTEMPTS; attempt += 1) {
    const response = await admin.graphql(COLLECTION_PRODUCTS_QUERY, {
      variables: {
        id: collectionGid,
        after: after ?? null,
      },
    });

    const json = (await response.json()) as CollectionProductsResponse;

    if (isThrottledResponse(json)) {
      lastThrottleMessage =
        json.errors?.map((error) => error.message).filter(Boolean).join(" ") ||
        lastThrottleMessage;

      if (attempt === THROTTLE_MAX_ATTEMPTS - 1) {
        break;
      }

      await wait(getThrottleWaitMs(json, attempt));
      continue;
    }

    const topLevelErrors =
      json.errors?.map((error) => error.message).filter(Boolean) ?? [];

    if (topLevelErrors.length > 0) {
      throw new Error(topLevelErrors.join(" "));
    }

    return json.data?.collection ?? null;
  }

  throw new Error(
    `Shopify kept throttling the collection membership lookup: ${lastThrottleMessage}`,
  );
}

/**
 * Read back what the store actually granted. Declaring a scope in
 * shopify.app.toml is not the same as having it: the config only reaches
 * Shopify via `shopify app deploy`, and the merchant then has to re-authorize.
 */
async function fetchGrantedScopes(admin: AdminGraphqlClient) {
  try {
    const response = await admin.graphql(GRANTED_SCOPES_QUERY);
    const json = (await response.json()) as {
      data?: {
        currentAppInstallation?: {
          accessScopes?: Array<{ handle?: string | null }> | null;
        } | null;
      };
    };

    return (
      json.data?.currentAppInstallation?.accessScopes
        ?.map((scope) => scope.handle)
        .filter((handle): handle is string => Boolean(handle)) ?? []
    );
  } catch (error) {
    console.error("[discounto/coverage] Could not read granted access scopes", {
      error,
    });
    return [];
  }
}

async function fetchCollectionSample(admin: AdminGraphqlClient) {
  try {
    const response = await admin.graphql(COLLECTION_SAMPLE_QUERY);
    const json = (await response.json()) as {
      errors?: Array<{ message?: string | null }>;
      data?: {
        collections?: {
          nodes?: Array<{ id?: string | null; handle?: string | null }>;
        } | null;
      };
    };

    if (json.errors?.length) {
      return {
        error: json.errors.map((error) => error.message).filter(Boolean).join(" "),
        collections: [] as Array<{ id?: string | null; handle?: string | null }>,
      };
    }

    return { error: null, collections: json.data?.collections?.nodes ?? [] };
  } catch (error) {
    return { error: String(error), collections: [] };
  }
}

async function buildMissingCollectionError({
  admin,
  collectionGid,
}: {
  admin: AdminGraphqlClient;
  collectionGid: string;
}) {
  const [grantedScopes, sample] = await Promise.all([
    fetchGrantedScopes(admin),
    fetchCollectionSample(admin),
  ]);
  const canReadProducts = grantedScopes.some(
    (scope) => scope === "read_products" || scope === "write_products",
  );
  const scopeList = grantedScopes.join(", ") || "none reported";
  const visible = sample.collections
    .map((collection) => `${collection.id ?? "?"} (${collection.handle ?? "?"})`)
    .join(", ");

  console.error("[discounto/coverage] Collection lookup returned nothing", {
    requestedGid: collectionGid,
    grantedScopes,
    sampleError: sample.error,
    collectionsVisibleToApp: visible || "none",
  });

  if (!canReadProducts) {
    return new Error(
      `The app cannot read collections on this store: neither read_products nor write_products is granted (granted: ${scopeList}). Run \`shopify app deploy\` to publish shopify.app.toml, then reinstall or re-authorize the app on the store.`,
    );
  }

  if (sample.collections.length === 0) {
    return new Error(
      `The app can not see any collections on this store even though product access is granted (granted: ${scopeList}${
        sample.error ? `; collections query said: ${sample.error}` : ""
      }).`,
    );
  }

  return new Error(
    `Shopify returned no collection for ${collectionGid}, but the app can see other collections on this store: ${visible}. The requested id likely belongs to a different store or has been deleted.`,
  );
}

async function resolveCollectionIdByHandle({
  admin,
  collectionHandle,
}: {
  admin: AdminGraphqlClient;
  collectionHandle: string;
}) {
  try {
    const response = await admin.graphql(COLLECTION_ID_BY_HANDLE_QUERY, {
      variables: { query: `handle:${collectionHandle}` },
    });
    const json = (await response.json()) as {
      errors?: Array<{ message?: string | null }>;
      data?: {
        collections?: {
          nodes?: Array<{ id?: string | null; handle?: string | null }>;
        } | null;
      };
    };

    if (json.errors?.length) {
      return null;
    }

    const match = json.data?.collections?.nodes?.find(
      (node) => node.handle === collectionHandle,
    );

    return match?.id ?? null;
  } catch (error) {
    console.error("[discounto/coverage] Handle lookup failed", {
      collectionHandle,
      error,
    });
    return null;
  }
}

async function fetchAllCollectionProducts({
  admin,
  collectionGid,
  collectionHandle,
}: {
  admin: AdminGraphqlClient;
  collectionGid: string;
  collectionHandle?: string | null;
}) {
  const products: EffectiveProductTarget[] = [];
  let cursor: string | null = null;
  let hasNextPage = true;
  let effectiveGid = collectionGid;

  while (hasNextPage) {
    let node = await fetchCollectionProductsPage({
      admin,
      collectionGid: effectiveGid,
      after: cursor,
    });

    // A stored id stops resolving the moment the merchant deletes and
    // recreates a collection. The handle survives that, so recover through it
    // rather than reporting the campaign as covering nothing.
    if (!node && collectionHandle && effectiveGid === collectionGid) {
      const recoveredGid = await resolveCollectionIdByHandle({
        admin,
        collectionHandle,
      });

      if (recoveredGid && recoveredGid !== collectionGid) {
        console.warn("[discounto/coverage] Stored collection id is stale, recovered by handle", {
          storedGid: collectionGid,
          recoveredGid,
          collectionHandle,
        });

        effectiveGid = recoveredGid;
        node = await fetchCollectionProductsPage({
          admin,
          collectionGid: effectiveGid,
          after: cursor,
        });
      }
    }

    // Reporting a missing collection as "0 products" is exactly what hid this
    // bug, so make it loud - and say which of the causes it actually is.
    if (!node) {
      throw await buildMissingCollectionError({ admin, collectionGid });
    }

    if (!node.products) {
      throw new Error(
        `Shopify returned a node for ${collectionGid} without a products connection (resolved id: ${
          node.id ?? "unknown"
        }).`,
      );
    }

    console.log("[discounto/coverage] Collection page resolved", {
      requestedGid: collectionGid,
      resolvedGid: node.id ?? null,
      handle: node.handle ?? null,
      nodesOnPage: node.products.nodes?.length ?? 0,
      hasNextPage: Boolean(node.products.pageInfo?.hasNextPage),
    });

    for (const product of node.products.nodes ?? []) {
      if (!product.id) {
        continue;
      }

      products.push({
        productGid: product.id,
        productTitle: product.title ?? null,
        productHandle: product.handle ?? null,
        imageUrl: null,
      });
    }

    hasNextPage = Boolean(node.products.pageInfo?.hasNextPage);
    cursor = node.products.pageInfo?.endCursor ?? null;
  }

  if (products.length === 0) {
    console.warn("[discounto/coverage] Collection resolved to zero products", {
      collectionGid,
    });
  }

  return products;
}

function resolveSingleCollection({
  admin,
  collectionGid,
  collectionHandle,
  cache,
}: {
  admin: AdminGraphqlClient;
  collectionGid: string;
  collectionHandle?: string | null;
  cache: CollectionResolutionCache;
}) {
  const cached = cache.get(collectionGid);

  if (cached) {
    return cached;
  }

  // Cache the promise, not the result, so parallel campaigns sharing a
  // collection issue a single Shopify query instead of racing each other.
  const pending = fetchAllCollectionProducts({
    admin,
    collectionGid,
    collectionHandle,
  }).catch((error) => {
    cache.delete(collectionGid);
    throw error;
  });

  cache.set(collectionGid, pending);

  return pending;
}

export async function resolveCollectionProducts({
  admin,
  selectedCollections,
  cache = createCollectionResolutionCache(),
}: {
  admin: AdminGraphqlClient;
  selectedCollections: Array<
    SelectedCollectionInput | { collectionGid: string }
  >;
  cache?: CollectionResolutionCache;
}) {
  const targets = collectUniqueCollectionTargets(selectedCollections);
  const resolvedProducts: EffectiveProductTarget[] = [];

  for (const target of targets) {
    resolvedProducts.push(
      ...(await resolveSingleCollection({
        admin,
        collectionGid: target.collectionGid,
        collectionHandle: target.collectionHandle,
        cache,
      })),
    );
  }

  return normalizeProducts(resolvedProducts);
}

export async function resolveCampaignTargetProducts({
  admin,
  selectedProducts,
  selectedCollections,
  cache = createCollectionResolutionCache(),
}: {
  admin: AdminGraphqlClient;
  selectedProducts: Array<
    SelectedProductInput | EffectiveProductTarget | { productGid: string }
  >;
  selectedCollections: Array<
    SelectedCollectionInput | { collectionGid: string }
  >;
  cache?: CollectionResolutionCache;
}) {
  const explicitProducts = normalizeProducts(selectedProducts);
  const collectionProducts = await resolveCollectionProducts({
    admin,
    selectedCollections,
    cache,
  });

  return normalizeProducts([...explicitProducts, ...collectionProducts]);
}

export async function buildEffectiveCoverageMap({
  admin,
  campaigns,
  cache = createCollectionResolutionCache(),
}: {
  admin: AdminGraphqlClient;
  campaigns: CampaignTargetSnapshot[];
  cache?: CollectionResolutionCache;
}) {
  // Warm every distinct collection once, sequentially, before fanning out. Ten
  // campaigns pointing at the same collection then cost one Shopify query.
  const targets = collectUniqueCollectionTargets(
    campaigns.flatMap((campaign) => campaign.collections),
  );

  // Deliberately not swallowing failures here. Caching an unresolved
  // collection as "no products" would put the lying zero straight back: the
  // caller must be able to tell "covers nothing" from "could not be read".
  for (const target of targets) {
    await resolveSingleCollection({
      admin,
      collectionGid: target.collectionGid,
      collectionHandle: target.collectionHandle,
      cache,
    });
  }

  const coverageEntries = await Promise.all(
    campaigns.map(async (campaign) => [
      campaign.id,
      await resolveCampaignTargetProducts({
        admin,
        selectedProducts: campaign.products,
        selectedCollections: campaign.collections,
        cache,
      }),
    ] as const),
  );

  return new Map<string, EffectiveProductTarget[]>(coverageEntries);
}

export function buildExplicitCoverageFallbackMap({
  campaigns,
}: {
  campaigns: CampaignTargetSnapshot[];
}) {
  return new Map<string, EffectiveProductTarget[]>(
    campaigns.map((campaign) => [
      campaign.id,
      normalizeProducts(campaign.products),
    ]),
  );
}
