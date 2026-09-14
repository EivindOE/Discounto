import type { DiscountKind } from "@prisma/client";
import {
  buildShippingFunctionConfiguration,
  offerIncludesDiscount,
  offerIncludesFreeShipping,
  type CampaignOfferType,
} from "../lib/campaign-offer";
import {
  automaticDiscountExistsInShopify,
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

/**
 * Runs an update against a discount that is expected to exist in Shopify. If
 * the update fails, this checks whether the stored ID is stale (the merchant
 * deleted the discount outside the app, or an app uninstall removed it) and,
 * if so, creates a replacement instead of surfacing an unrecoverable error.
 * A genuine failure (the discount still exists) rethrows unchanged.
 */
async function updateOrRecreate({
  admin,
  shopifyDiscountId,
  update,
  create,
}: {
  admin: AdminGraphqlClient;
  shopifyDiscountId: string;
  update: () => Promise<{ shopifyDiscountId: string }>;
  create: () => Promise<{ shopifyDiscountId: string }>;
}): Promise<{ shopifyDiscountId: string; created: boolean }> {
  try {
    const result = await update();
    return { shopifyDiscountId: result.shopifyDiscountId, created: false };
  } catch (error) {
    const stillExists = await automaticDiscountExistsInShopify({ admin, shopifyDiscountId });

    if (stillExists) {
      throw error;
    }

    const result = await create();
    return { shopifyDiscountId: result.shopifyDiscountId, created: true };
  }
}

/**
 * Deletes a discount, treating a failed delete as a success when the
 * discount already does not exist in Shopify. A genuine failure (the
 * discount still exists) rethrows unchanged.
 */
async function deleteOrTreatAsGone({
  admin,
  shopifyDiscountId,
}: {
  admin: AdminGraphqlClient;
  shopifyDiscountId: string;
}): Promise<void> {
  try {
    await deleteAutomaticDiscountInShopify({ admin, shopifyDiscountId });
  } catch (error) {
    const stillExists = await automaticDiscountExistsInShopify({ admin, shopifyDiscountId });

    if (stillExists) {
      throw error;
    }
  }
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
  freeShippingBadgeText,
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
  freeShippingBadgeText?: string | null;
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
        const existingDiscountId = ids.shopifyDiscountId;
        const outcome = await updateOrRecreate({
          admin,
          shopifyDiscountId: existingDiscountId,
          update: () =>
            updateAutomaticDiscountInShopify({
              ...discountInput,
              shopifyDiscountId: existingDiscountId,
            }),
          create: () => createAutomaticDiscountInShopify(discountInput),
        });
        ids.shopifyDiscountId = outcome.shopifyDiscountId;
        if (outcome.created) {
          created.push("shopifyDiscountId");
        }
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
        configuration: buildShippingFunctionConfiguration({
          selectedProducts,
          selectedCollections,
          freeShippingBadgeText,
        }),
        startsAt,
        endsAt,
      };

      if (ids.shopifyShippingDiscountId) {
        const existingShippingDiscountId = ids.shopifyShippingDiscountId;
        const outcome = await updateOrRecreate({
          admin,
          shopifyDiscountId: existingShippingDiscountId,
          update: () =>
            updateShippingDiscountInShopify({
              ...shippingInput,
              shopifyDiscountId: existingShippingDiscountId,
            }),
          create: () => createShippingDiscountInShopify(shippingInput),
        });
        ids.shopifyShippingDiscountId = outcome.shopifyDiscountId;
        if (outcome.created) {
          created.push("shopifyShippingDiscountId");
        }
      } else {
        const result = await createShippingDiscountInShopify(shippingInput);
        ids.shopifyShippingDiscountId = result.shopifyDiscountId;
        created.push("shopifyShippingDiscountId");
      }
    }

    // Deletes run last so a failed create or update never strips the campaign
    // of the discount it had before this sync.
    if (!includesDiscount && ids.shopifyDiscountId) {
      await deleteOrTreatAsGone({ admin, shopifyDiscountId: ids.shopifyDiscountId });
      ids.shopifyDiscountId = null;
    }

    if (!includesFreeShipping && ids.shopifyShippingDiscountId) {
      await deleteOrTreatAsGone({
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

      await deleteOrTreatAsGone({ admin, shopifyDiscountId });
      remaining[key] = null;
    }
  } catch (error) {
    throw new CampaignSyncError(getErrorMessage(error), remaining);
  }
}
