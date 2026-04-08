import type {
  SelectedCollectionInput,
  SelectedProductInput,
} from "./discount.server";

const COLLECTION_PRODUCTS_QUERY = `#graphql
  query DiscountoCollectionProducts($id: ID!, $after: String) {
    node(id: $id) {
      ... on Collection {
        id
        title
        handle
        image {
          url
        }
        products(first: 250, after: $after) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            id
            title
            handle
            featuredImage {
              url
            }
          }
        }
      }
    }
  }
`;

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

type CollectionNode = {
  id?: string | null;
  title?: string | null;
  handle?: string | null;
  image?: { url?: string | null } | null;
  products?: {
    pageInfo?: {
      hasNextPage?: boolean | null;
      endCursor?: string | null;
    } | null;
    nodes?: Array<{
      id?: string | null;
      title?: string | null;
      handle?: string | null;
      featuredImage?: { url?: string | null } | null;
    }>;
  } | null;
} | null;

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

async function fetchCollectionProductsPage({
  admin,
  collectionGid,
  after,
}: {
  admin: AdminGraphqlClient;
  collectionGid: string;
  after?: string | null;
}) {
  const response = await admin.graphql(COLLECTION_PRODUCTS_QUERY, {
    variables: {
      id: collectionGid,
      after: after ?? null,
    },
  });

  const json = (await response.json()) as {
    errors?: Array<{ message?: string | null }>;
    data?: { node?: CollectionNode };
  };

  const topLevelErrors = json.errors?.map((error) => error.message).filter(Boolean) ?? [];

  if (topLevelErrors.length > 0) {
    throw new Error(topLevelErrors.join(" "));
  }

  return json.data?.node ?? null;
}

export async function resolveCollectionProducts({
  admin,
  selectedCollections,
}: {
  admin: AdminGraphqlClient;
  selectedCollections: Array<
    SelectedCollectionInput | { collectionGid: string }
  >;
}) {
  const resolvedProducts: EffectiveProductTarget[] = [];

  for (const collection of selectedCollections) {
    const collectionGid = collection.collectionGid?.trim();

    if (!collectionGid) {
      continue;
    }

    let cursor: string | null = null;
    let hasNextPage = true;

    while (hasNextPage) {
      const node = await fetchCollectionProductsPage({
        admin,
        collectionGid,
        after: cursor,
      });

      const products = node?.products?.nodes ?? [];

      for (const product of products) {
        if (!product.id) {
          continue;
        }

        resolvedProducts.push({
          productGid: product.id,
          productTitle: product.title ?? null,
          productHandle: product.handle ?? null,
          imageUrl: product.featuredImage?.url ?? null,
        });
      }

      hasNextPage = Boolean(node?.products?.pageInfo?.hasNextPage);
      cursor = node?.products?.pageInfo?.endCursor ?? null;
    }
  }

  return normalizeProducts(resolvedProducts);
}

export async function resolveCampaignTargetProducts({
  admin,
  selectedProducts,
  selectedCollections,
}: {
  admin: AdminGraphqlClient;
  selectedProducts: Array<
    SelectedProductInput | EffectiveProductTarget | { productGid: string }
  >;
  selectedCollections: Array<
    SelectedCollectionInput | { collectionGid: string }
  >;
}) {
  const explicitProducts = normalizeProducts(selectedProducts);
  const collectionProducts = await resolveCollectionProducts({
    admin,
    selectedCollections,
  });

  return normalizeProducts([...explicitProducts, ...collectionProducts]);
}

export async function buildEffectiveCoverageMap({
  admin,
  campaigns,
}: {
  admin: AdminGraphqlClient;
  campaigns: CampaignTargetSnapshot[];
}) {
  const coverageEntries = await Promise.all(
    campaigns.map(async (campaign) => [
      campaign.id,
      await resolveCampaignTargetProducts({
        admin,
        selectedProducts: campaign.products,
        selectedCollections: campaign.collections,
      }),
    ] as const),
  );

  return new Map<string, EffectiveProductTarget[]>(coverageEntries);
}
