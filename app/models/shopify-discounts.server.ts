import type { DiscountKind } from "@prisma/client";

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
      shippingDiscounts: false,
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
      shippingDiscounts: false,
    },
  };
}

async function parseDiscountMutationResponse(
  response: Response,
  payloadKey:
    | "discountAutomaticBasicCreate"
    | "discountAutomaticBasicUpdate"
    | "discountAutomaticDelete",
) {
  const json = (await response.json()) as {
    errors?: Array<{ message?: string | null }>;
    data?: Record<
      string,
      | {
          automaticDiscountNode?: { id?: string | null } | null;
          deletedAutomaticDiscountId?: string | null;
          userErrors?: Array<{ message?: string | null }>;
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
