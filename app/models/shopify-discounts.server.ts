import type { DiscountKind } from "@prisma/client";
import type { ShippingFunctionConfiguration } from "../lib/campaign-offer";

const CREATE_AUTOMATIC_BASIC_DISCOUNT_MUTATION = `#graphql
  mutation CreateAutomaticBasicDiscount($automaticBasicDiscount: DiscountAutomaticBasicInput!) {
    discountAutomaticBasicCreate(automaticBasicDiscount: $automaticBasicDiscount) {
      automaticDiscountNode {
        id
      }
      userErrors {
        field
        code
        message
      }
    }
  }
`;

const UPDATE_AUTOMATIC_BASIC_DISCOUNT_MUTATION = `#graphql
  mutation UpdateAutomaticBasicDiscount($id: ID!, $automaticBasicDiscount: DiscountAutomaticBasicInput!) {
    discountAutomaticBasicUpdate(id: $id, automaticBasicDiscount: $automaticBasicDiscount) {
      automaticDiscountNode {
        id
      }
      userErrors {
        field
        code
        message
      }
    }
  }
`;

const DELETE_AUTOMATIC_DISCOUNT_MUTATION = `#graphql
  mutation DeleteAutomaticDiscount($id: ID!) {
    discountAutomaticDelete(id: $id) {
      deletedAutomaticDiscountId
      userErrors {
        field
        code
        message
      }
    }
  }
`;

const CREATE_AUTOMATIC_APP_DISCOUNT_MUTATION = `#graphql
  mutation CreateAutomaticAppDiscount($automaticAppDiscount: DiscountAutomaticAppInput!) {
    discountAutomaticAppCreate(automaticAppDiscount: $automaticAppDiscount) {
      automaticAppDiscount {
        discountId
      }
      userErrors {
        field
        code
        message
      }
    }
  }
`;

const UPDATE_AUTOMATIC_APP_DISCOUNT_MUTATION = `#graphql
  mutation UpdateAutomaticAppDiscount($id: ID!, $automaticAppDiscount: DiscountAutomaticAppInput!) {
    discountAutomaticAppUpdate(id: $id, automaticAppDiscount: $automaticAppDiscount) {
      automaticAppDiscount {
        discountId
      }
      userErrors {
        field
        code
        message
      }
    }
  }
`;

const AUTOMATIC_DISCOUNT_EXISTS_QUERY = `#graphql
  query DiscountoAutomaticDiscountExists($id: ID!) {
    automaticDiscountNode(id: $id) {
      id
    }
  }
`;

const SET_FUNCTION_CONFIGURATION_MUTATION = `#graphql
  mutation SetDiscountFunctionConfiguration($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields {
        id
      }
      userErrors {
        field
        code
        message
      }
    }
  }
`;

export const FREE_SHIPPING_FUNCTION_HANDLE = "discounto-free-shipping";
const FUNCTION_CONFIGURATION_NAMESPACE = "$app";
const FUNCTION_CONFIGURATION_KEY = "function-configuration";

// The shipping discount must stack with the campaign's own product discount.
const SHIPPING_DISCOUNT_COMBINES_WITH = {
  orderDiscounts: false,
  productDiscounts: true,
  shippingDiscounts: false,
};

type SelectedProduct = {
  productGid: string;
};

type SelectedCollection = {
  collectionGid: string;
};

type AdminGraphqlClient = {
  graphql: (
    query: string,
    options?: {
      variables?: Record<string, unknown>;
    },
  ) => Promise<Response>;
};

type DiscountInput = {
  title: string;
  discountKind: DiscountKind;
  discountValue: number;
  selectedProducts: SelectedProduct[];
  selectedCollections?: SelectedCollection[];
  startsAt?: Date | null;
  endsAt?: Date | null;
  combinesWithShippingDiscounts?: boolean;
};

function buildDiscountValue({
  discountKind,
  discountValue,
}: Pick<DiscountInput, "discountKind" | "discountValue">) {
  return discountKind === "PERCENTAGE"
    ? {
        percentage: discountValue / 100,
      }
    : {
        discountAmount: {
          amount: discountValue.toFixed(2),
          appliesOnEachItem: true,
        },
      };
}

function buildCreateItemsInput({
  selectedProducts,
  selectedCollections,
}: Pick<DiscountInput, "selectedProducts" | "selectedCollections">) {
  const collectionIds = selectedCollections?.map((collection) => collection.collectionGid) ?? [];
  const productIds = selectedProducts.map((product) => product.productGid);

  if (collectionIds.length > 0) {
    return {
      collections: {
        add: collectionIds,
      },
    };
  }

  return {
    products: {
      productsToAdd: productIds,
    },
  };
}

function buildUpdateItemsInput({
  selectedProducts,
  selectedCollections,
}: Pick<DiscountInput, "selectedProducts" | "selectedCollections">) {
  const collectionIds = selectedCollections?.map((collection) => collection.collectionGid) ?? [];
  const productIds = selectedProducts.map((product) => product.productGid);

  if (collectionIds.length > 0) {
    return {
      collections: {
        add: collectionIds,
      },
    };
  }

  return {
    products: {
      productsToAdd: productIds,
    },
  };
}

function buildCreateAutomaticBasicDiscountInput({
  title,
  discountKind,
  discountValue,
  selectedProducts,
  selectedCollections,
  startsAt,
  endsAt,
  combinesWithShippingDiscounts,
}: DiscountInput) {
  return {
    title,
    startsAt: (startsAt ?? new Date()).toISOString(),
    ...(endsAt ? { endsAt: endsAt.toISOString() } : {}),
    customerGets: {
      value: buildDiscountValue({ discountKind, discountValue }),
      items: buildCreateItemsInput({ selectedProducts, selectedCollections }),
    },
    combinesWith: {
      orderDiscounts: false,
      productDiscounts: false,
      shippingDiscounts: combinesWithShippingDiscounts ?? false,
    },
  };
}

function buildUpdateAutomaticBasicDiscountInput({
  title,
  discountKind,
  discountValue,
  selectedProducts,
  selectedCollections,
  startsAt,
  endsAt,
  combinesWithShippingDiscounts,
}: DiscountInput) {
  return {
    title,
    startsAt: (startsAt ?? new Date()).toISOString(),
    ...(endsAt ? { endsAt: endsAt.toISOString() } : {}),
    customerGets: {
      value: buildDiscountValue({ discountKind, discountValue }),
      items: buildUpdateItemsInput({ selectedProducts, selectedCollections }),
    },
    combinesWith: {
      orderDiscounts: false,
      productDiscounts: false,
      shippingDiscounts: combinesWithShippingDiscounts ?? false,
    },
  };
}

async function parseDiscountMutationResponse(
  response: Response,
  payloadKey:
    | "discountAutomaticBasicCreate"
    | "discountAutomaticBasicUpdate"
    | "discountAutomaticDelete"
    | "discountAutomaticAppCreate"
    | "discountAutomaticAppUpdate"
    | "metafieldsSet",
) {
  const json = (await response.json()) as {
    errors?: Array<{ message?: string | null }>;
    data?: Record<
      string,
      | {
          automaticDiscountNode?: { id?: string | null } | null;
          automaticAppDiscount?: { discountId?: string | null } | null;
          deletedAutomaticDiscountId?: string | null;
          userErrors?: Array<{ message?: string | null }>;
          metafields?: Array<{ id?: string | null }>;
        }
      | undefined
    >;
  };

  const topLevelErrors = json.errors?.map((error) => error.message).filter(Boolean) ?? [];
  const payload = json.data?.[payloadKey];
  const userErrors =
    payload?.userErrors?.map((error) => error.message).filter(Boolean) ?? [];

  if (topLevelErrors.length > 0) {
    throw new Error(topLevelErrors.join(" "));
  }

  if (userErrors.length > 0) {
    throw new Error(userErrors.join(" "));
  }

  return payload ?? null;
}

export async function createAutomaticDiscountInShopify({
  admin,
  title,
  discountKind,
  discountValue,
  selectedProducts,
  selectedCollections,
  startsAt,
  endsAt,
  combinesWithShippingDiscounts,
}: DiscountInput & {
  admin: AdminGraphqlClient;
}) {
  const response = await admin.graphql(CREATE_AUTOMATIC_BASIC_DISCOUNT_MUTATION, {
    variables: {
      automaticBasicDiscount: buildCreateAutomaticBasicDiscountInput({
        title,
        discountKind,
        discountValue,
        selectedProducts,
        selectedCollections,
        startsAt,
        endsAt,
        combinesWithShippingDiscounts,
      }),
    },
  });

  const payload = await parseDiscountMutationResponse(
    response,
    "discountAutomaticBasicCreate",
  );
  const shopifyDiscountId = payload?.automaticDiscountNode?.id;

  if (!shopifyDiscountId) {
    throw new Error("Shopify did not return a discount ID for the new automatic discount.");
  }

  return {
    shopifyDiscountId,
  };
}

export async function updateAutomaticDiscountInShopify({
  admin,
  shopifyDiscountId,
  title,
  discountKind,
  discountValue,
  selectedProducts,
  selectedCollections,
  startsAt,
  endsAt,
  combinesWithShippingDiscounts,
}: DiscountInput & {
  admin: AdminGraphqlClient;
  shopifyDiscountId: string;
}) {
  const response = await admin.graphql(UPDATE_AUTOMATIC_BASIC_DISCOUNT_MUTATION, {
    variables: {
      id: shopifyDiscountId,
      automaticBasicDiscount: buildUpdateAutomaticBasicDiscountInput({
        title,
        discountKind,
        discountValue,
        selectedProducts,
        selectedCollections,
        startsAt,
        endsAt,
        combinesWithShippingDiscounts,
      }),
    },
  });

  const payload = await parseDiscountMutationResponse(
    response,
    "discountAutomaticBasicUpdate",
  );
  const updatedDiscountId = payload?.automaticDiscountNode?.id;

  if (!updatedDiscountId) {
    throw new Error("Shopify did not return a discount ID after updating the campaign.");
  }

  return {
    shopifyDiscountId: updatedDiscountId,
  };
}

export async function deleteAutomaticDiscountInShopify({
  admin,
  shopifyDiscountId,
}: {
  admin: AdminGraphqlClient;
  shopifyDiscountId: string;
}) {
  const response = await admin.graphql(DELETE_AUTOMATIC_DISCOUNT_MUTATION, {
    variables: {
      id: shopifyDiscountId,
    },
  });

  await parseDiscountMutationResponse(response, "discountAutomaticDelete");
}

/**
 * Checks whether an automatic discount still exists in Shopify. Used to
 * recover a campaign whose stored discount ID was deleted outside the app
 * (in Shopify admin, or by an app uninstall).
 */
export async function automaticDiscountExistsInShopify({
  admin,
  shopifyDiscountId,
}: {
  admin: AdminGraphqlClient;
  shopifyDiscountId: string;
}): Promise<boolean> {
  const response = await admin.graphql(AUTOMATIC_DISCOUNT_EXISTS_QUERY, {
    variables: {
      id: shopifyDiscountId,
    },
  });

  const json = (await response.json()) as {
    errors?: Array<{ message?: string | null }>;
    data?: {
      automaticDiscountNode?: { id?: string | null } | null;
    };
  };

  const topLevelErrors = json.errors?.map((error) => error.message).filter(Boolean) ?? [];

  if (topLevelErrors.length > 0) {
    throw new Error(topLevelErrors.join(" "));
  }

  return json.data?.automaticDiscountNode != null;
}

type ShippingDiscountInput = {
  title: string;
  configuration: ShippingFunctionConfiguration;
  startsAt?: Date | null;
  endsAt?: Date | null;
};

// Shopify requires automatic discount titles to be unique, and a campaign with
// both offers already uses its own title for the product discount.
const SHIPPING_DISCOUNT_TITLE_SUFFIX = " – Free shipping";

function buildShippingDiscountSchedule({
  title,
  startsAt,
  endsAt,
}: Pick<ShippingDiscountInput, "title" | "startsAt" | "endsAt">) {
  return {
    title: `${title}${SHIPPING_DISCOUNT_TITLE_SUFFIX}`,
    startsAt: (startsAt ?? new Date()).toISOString(),
    ...(endsAt ? { endsAt: endsAt.toISOString() } : {}),
  };
}

export async function createShippingDiscountInShopify({
  admin,
  title,
  configuration,
  startsAt,
  endsAt,
}: ShippingDiscountInput & {
  admin: AdminGraphqlClient;
}) {
  const response = await admin.graphql(CREATE_AUTOMATIC_APP_DISCOUNT_MUTATION, {
    variables: {
      automaticAppDiscount: {
        ...buildShippingDiscountSchedule({ title, startsAt, endsAt }),
        functionHandle: FREE_SHIPPING_FUNCTION_HANDLE,
        discountClasses: ["SHIPPING"],
        combinesWith: SHIPPING_DISCOUNT_COMBINES_WITH,
        metafields: [
          {
            namespace: FUNCTION_CONFIGURATION_NAMESPACE,
            key: FUNCTION_CONFIGURATION_KEY,
            type: "json",
            value: JSON.stringify(configuration),
          },
        ],
      },
    },
  });

  const payload = await parseDiscountMutationResponse(response, "discountAutomaticAppCreate");
  const shopifyDiscountId = payload?.automaticAppDiscount?.discountId;

  if (!shopifyDiscountId) {
    throw new Error("Shopify did not return a discount ID for the new free shipping discount.");
  }

  return {
    shopifyDiscountId,
  };
}

export async function updateShippingDiscountInShopify({
  admin,
  shopifyDiscountId,
  title,
  configuration,
  startsAt,
  endsAt,
}: ShippingDiscountInput & {
  admin: AdminGraphqlClient;
  shopifyDiscountId: string;
}) {
  const response = await admin.graphql(UPDATE_AUTOMATIC_APP_DISCOUNT_MUTATION, {
    variables: {
      id: shopifyDiscountId,
      automaticAppDiscount: {
        ...buildShippingDiscountSchedule({ title, startsAt, endsAt }),
        discountClasses: ["SHIPPING"],
        combinesWith: SHIPPING_DISCOUNT_COMBINES_WITH,
      },
    },
  });

  const payload = await parseDiscountMutationResponse(response, "discountAutomaticAppUpdate");
  const updatedDiscountId = payload?.automaticAppDiscount?.discountId;

  if (!updatedDiscountId) {
    throw new Error(
      "Shopify did not return a discount ID after updating the free shipping discount.",
    );
  }

  // discountAutomaticAppUpdate does not document overwriting metafields, so the
  // configuration is written with metafieldsSet, which upserts by namespace and key.
  const metafieldResponse = await admin.graphql(SET_FUNCTION_CONFIGURATION_MUTATION, {
    variables: {
      metafields: [
        {
          ownerId: updatedDiscountId,
          namespace: FUNCTION_CONFIGURATION_NAMESPACE,
          key: FUNCTION_CONFIGURATION_KEY,
          type: "json",
          value: JSON.stringify(configuration),
        },
      ],
    },
  });

  await parseDiscountMutationResponse(metafieldResponse, "metafieldsSet");

  return {
    shopifyDiscountId: updatedDiscountId,
  };
}
