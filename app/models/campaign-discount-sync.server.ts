import type { DiscountKind } from "@prisma/client";
import {
  buildShippingFunctionConfiguration,
  offerIncludesDiscount,
  offerIncludesFreeShipping,
  type CampaignOfferType,
} from "../lib/campaign-offer";
import {
  createAutomaticDiscountInShopify,
  createShippingDiscountInShopify,
  deleteAutomaticDiscountInShopify,
  updateAutomaticDiscountInShopify,
  updateShippingDiscountInShopify,
} from "./shopify-discounts.server";

type AdminGraphqlClient = {
  graphql: (
    query: string,
    options?: {
      variables?: Record<string, unknown>;
    },
  ) => Promise<Response>;
};

export type CampaignDiscountIds = {
  shopifyDiscountId: string | null;
  shopifyShippingDiscountId: string | null;
};

/**
 * Carries the discount IDs that exist in Shopify after a failed sync, so the
 * campaign row keeps pointing at real discounts instead of deleted ones.
 */
export class CampaignSyncError extends Error {
  readonly ids: CampaignDiscountIds;

  constructor(message: string, ids: CampaignDiscountIds) {
    super(message);
    this.name = "CampaignSyncError";
    this.ids = ids;
  }
}

function getErrorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "An unexpected error stopped the Shopify discount sync.";
}

export async function syncCampaignDiscountsInShopify({
  admin,
  existingIds,
  title,
  offerType,
  discountKind,
  discountValue,
  selectedProducts,
  selectedCollections,
  discountProducts,
  startsAt,
  endsAt,
}: {
  admin: AdminGraphqlClient;
  existingIds: CampaignDiscountIds;
  title: string;
  offerType: CampaignOfferType;
  discountKind: DiscountKind | null;
  discountValue: number | null;
  selectedProducts: Array<{ productGid: string }>;
  selectedCollections: Array<{ collectionGid: string }>;
  discountProducts: Array<{ productGid: string }>;
  startsAt?: Date | null;
  endsAt?: Date | null;
}): Promise<CampaignDiscountIds> {
  const ids: CampaignDiscountIds = { ...existingIds };
  const created: Array<keyof CampaignDiscountIds> = [];
  const includesDiscount = offerIncludesDiscount(offerType);
  const includesFreeShipping = offerIncludesFreeShipping(offerType);

  try {
    if (includesDiscount) {
      if (discountKind == null || discountValue == null) {
        throw new Error("This campaign is missing its discount value.");
      }

      const discountInput = {
        admin,
        title,
        discountKind,
        discountValue,
        selectedProducts: discountProducts,
        selectedCollections,
        startsAt,
        endsAt,
        combinesWithShippingDiscounts: includesFreeShipping,
      };

      if (ids.shopifyDiscountId) {
        const result = await updateAutomaticDiscountInShopify({
          ...discountInput,
          shopifyDiscountId: ids.shopifyDiscountId,
        });
        ids.shopifyDiscountId = result.shopifyDiscountId;
      } else {
        const result = await createAutomaticDiscountInShopify(discountInput);
        ids.shopifyDiscountId = result.shopifyDiscountId;
        created.push("shopifyDiscountId");
      }
    }

    if (includesFreeShipping) {
      const shippingInput = {
        admin,
        title,
        configuration: buildShippingFunctionConfiguration({ selectedProducts, selectedCollections }),
        startsAt,
        endsAt,
      };

      if (ids.shopifyShippingDiscountId) {
        const result = await updateShippingDiscountInShopify({
          ...shippingInput,
          shopifyDiscountId: ids.shopifyShippingDiscountId,
        });
        ids.shopifyShippingDiscountId = result.shopifyDiscountId;
      } else {
        const result = await createShippingDiscountInShopify(shippingInput);
        ids.shopifyShippingDiscountId = result.shopifyDiscountId;
        created.push("shopifyShippingDiscountId");
      }
    }

    // Deletes run last so a failed create or update never strips the campaign
    // of the discount it had before this sync.
    if (!includesDiscount && ids.shopifyDiscountId) {
      await deleteAutomaticDiscountInShopify({ admin, shopifyDiscountId: ids.shopifyDiscountId });
      ids.shopifyDiscountId = null;
    }

    if (!includesFreeShipping && ids.shopifyShippingDiscountId) {
      await deleteAutomaticDiscountInShopify({
        admin,
        shopifyDiscountId: ids.shopifyShippingDiscountId,
      });
      ids.shopifyShippingDiscountId = null;
    }

    return ids;
  } catch (error) {
    for (const key of created) {
      const shopifyDiscountId = ids[key];

      if (!shopifyDiscountId) {
        continue;
      }

      try {
        await deleteAutomaticDiscountInShopify({ admin, shopifyDiscountId });
        ids[key] = null;
      } catch (rollbackError) {
        console.error("[discounto/sync] Could not roll back a discount created during a failed sync", {
          rollbackError,
          shopifyDiscountId,
        });
      }
    }

    throw new CampaignSyncError(getErrorMessage(error), ids);
  }
}

export async function deleteCampaignDiscountsInShopify({
  admin,
  ids,
}: {
  admin: AdminGraphqlClient;
  ids: CampaignDiscountIds;
}) {
  const remaining: CampaignDiscountIds = { ...ids };

  try {
    for (const key of ["shopifyDiscountId", "shopifyShippingDiscountId"] as const) {
      const shopifyDiscountId = remaining[key];

      if (!shopifyDiscountId) {
        continue;
      }

      await deleteAutomaticDiscountInShopify({ admin, shopifyDiscountId });
      remaining[key] = null;
    }
  } catch (error) {
    throw new CampaignSyncError(getErrorMessage(error), remaining);
  }
}
