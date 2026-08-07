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

// Cheap cross-check (~12 points): if the app can list collections but not the
// one the picker handed us, the id is the problem, not the access.
const COLLECTION_SAMPLE_QUERY = `#graphql
  query DiscountoCollectionSample {
    collections(first: 10) {
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

function collectUniqueCollectionGids(
  collections: Array<
    SelectedCollectionInput | { collectionGid: string } | null | undefined
  >,
) {
  const gids: string[] = [];
  const seen = new Set<string>();

  for (const collection of collections) {
    const collectionGid = collection?.collectionGid?.trim();

    if (!collectionGid || seen.has(collectionGid)) {
      continue;
    }

    seen.add(collectionGid);
    gids.push(collectionGid);
  }

  return gids;
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

async function fetchAllCollectionProducts({
  admin,
  collectionGid,
}: {
  admin: AdminGraphqlClient;
  collectionGid: string;
}) {
  const products: EffectiveProductTarget[] = [];
  let cursor: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const node = await fetchCollectionProductsPage({
      admin,
      collectionGid,
      after: cursor,
    });

    // Reporting a missing collection as "0 products" is exactly what hid this
    // bug, so make it loud - and say which of the two causes it actually is.
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
  cache,
}: {
  admin: AdminGraphqlClient;
  collectionGid: string;
  cache: CollectionResolutionCache;
}) {
  const cached = cache.get(collectionGid);

  if (cached) {
    return cached;
  }

  // Cache the promise, not the result, so parallel campaigns sharing a
  // collection issue a single Shopify query instead of racing each other.
  const pending = fetchAllCollectionProducts({ admin, collectionGid }).catch(
    (error) => {
      cache.delete(collectionGid);
      throw error;
    },
  );

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
  const collectionGids = collectUniqueCollectionGids(selectedCollections);
  const resolvedProducts: EffectiveProductTarget[] = [];

  for (const collectionGid of collectionGids) {
    resolvedProducts.push(
      ...(await resolveSingleCollection({ admin, collectionGid, cache })),
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
  const collectionGids = collectUniqueCollectionGids(
    campaigns.flatMap((campaign) => campaign.collections),
  );

  for (const collectionGid of collectionGids) {
    await resolveSingleCollection({ admin, collectionGid, cache });
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
