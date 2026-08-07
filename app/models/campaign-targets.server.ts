import type {
  SelectedCollectionInput,
  SelectedProductInput,
} from "./discount.server";

// Keep this query as cheap as possible. Shopify prices a connection up front as
// `first` x (cost of each node), so every extra object field costs 250 points on
// its own. Only the id/handle are consumed downstream, so no nested objects here.
const COLLECTION_PRODUCTS_QUERY = `#graphql
  query DiscountoCollectionProducts($id: ID!, $after: String) {
    node(id: $id) {
      ... on Collection {
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
  data?: { node?: CollectionNode };
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

    return json.data?.node ?? null;
  }

  throw new Error(
    `Shopify kept throttling the collection membership lookup: ${lastThrottleMessage}`,
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

    for (const product of node?.products?.nodes ?? []) {
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

    hasNextPage = Boolean(node?.products?.pageInfo?.hasNextPage);
    cursor = node?.products?.pageInfo?.endCursor ?? null;
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
