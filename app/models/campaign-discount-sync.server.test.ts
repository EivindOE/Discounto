import { describe, expect, it } from "vitest";
import { createFakeAdmin } from "../test/fake-admin";
import {
  CampaignSyncError,
  deleteCampaignDiscountsInShopify,
  syncCampaignDiscountsInShopify,
} from "./campaign-discount-sync.server";

const PRODUCT = "gid://shopify/Product/1";
const BASIC = "gid://shopify/DiscountAutomaticNode/10";
const BASIC2 = "gid://shopify/DiscountAutomaticNode/11";
const SHIPPING = "gid://shopify/DiscountAutomaticNode/20";
const SHIPPING2 = "gid://shopify/DiscountAutomaticNode/21";

const basicCreated = {
  data: {
    discountAutomaticBasicCreate: { automaticDiscountNode: { id: BASIC }, userErrors: [] },
  },
};
const basicCreated2 = {
  data: {
    discountAutomaticBasicCreate: { automaticDiscountNode: { id: BASIC2 }, userErrors: [] },
  },
};
const basicUpdated = {
  data: {
    discountAutomaticBasicUpdate: { automaticDiscountNode: { id: BASIC }, userErrors: [] },
  },
};
const basicUpdateFailed = {
  data: {
    discountAutomaticBasicUpdate: {
      automaticDiscountNode: null,
      userErrors: [{ message: "Discount does not exist" }],
    },
  },
};
const shippingCreated = {
  data: {
    discountAutomaticAppCreate: { automaticAppDiscount: { discountId: SHIPPING }, userErrors: [] },
  },
};
const shippingCreated2 = {
  data: {
    discountAutomaticAppCreate: { automaticAppDiscount: { discountId: SHIPPING2 }, userErrors: [] },
  },
};
const shippingCreateFailed = {
  data: {
    discountAutomaticAppCreate: {
      automaticAppDiscount: null,
      userErrors: [{ message: "Maximum automatic discounts reached." }],
    },
  },
};
const shippingUpdateFailed = {
  data: {
    discountAutomaticAppUpdate: {
      automaticAppDiscount: null,
      userErrors: [{ message: "Discount does not exist" }],
    },
  },
};
const deleted = (id: string) => ({
  data: { discountAutomaticDelete: { deletedAutomaticDiscountId: id, userErrors: [] } },
});
const deleteFailed = {
  data: {
    discountAutomaticDelete: {
      deletedAutomaticDiscountId: null,
      userErrors: [{ message: "Discount does not exist" }],
    },
  },
};
const existsFalse = { data: { automaticDiscountNode: null } };
const existsTrue = (id: string) => ({ data: { automaticDiscountNode: { id } } });

const noIds = { shopifyDiscountId: null, shopifyShippingDiscountId: null };
const campaign = {
  title: "Summer",
  discountKind: "PERCENTAGE" as const,
  discountValue: 10,
  selectedProducts: [{ productGid: PRODUCT }],
  selectedCollections: [],
  discountProducts: [{ productGid: PRODUCT }],
  startsAt: null,
  endsAt: null,
};

function basicInput(call: { variables?: Record<string, unknown> }) {
  return call.variables?.automaticBasicDiscount as { combinesWith: { shippingDiscounts: boolean } };
}

describe("syncCampaignDiscountsInShopify", () => {
  it("creates only the product discount for a discount campaign", async () => {
    const { admin, calls } = createFakeAdmin([basicCreated]);

    const ids = await syncCampaignDiscountsInShopify({
      admin,
      existingIds: noIds,
      offerType: "DISCOUNT",
      ...campaign,
    });

    expect(ids).toEqual({ shopifyDiscountId: BASIC, shopifyShippingDiscountId: null });
    expect(calls).toHaveLength(1);
    expect(basicInput(calls[0]).combinesWith.shippingDiscounts).toBe(false);
  });

  it("creates only the shipping discount for a free shipping campaign", async () => {
    const { admin, calls } = createFakeAdmin([shippingCreated]);

    const ids = await syncCampaignDiscountsInShopify({
      admin,
      existingIds: noIds,
      offerType: "FREE_SHIPPING",
      ...campaign,
      discountKind: null,
      discountValue: null,
    });

    expect(ids).toEqual({ shopifyDiscountId: null, shopifyShippingDiscountId: SHIPPING });
    expect(calls).toHaveLength(1);
    const input = calls[0].variables?.automaticAppDiscount as {
      metafields: Array<{ value: string }>;
    };
    expect(JSON.parse(input.metafields[0].value)).toEqual({
      productIds: [PRODUCT],
      collectionIds: [],
      message: "Free shipping",
    });
  });

  it("carries the campaign's free shipping badge text into the function configuration message", async () => {
    const { admin, calls } = createFakeAdmin([shippingCreated]);

    await syncCampaignDiscountsInShopify({
      admin,
      existingIds: noIds,
      offerType: "FREE_SHIPPING",
      ...campaign,
      discountKind: null,
      discountValue: null,
      freeShippingBadgeText: "Fri frakt",
    });

    const input = calls[0].variables?.automaticAppDiscount as {
      metafields: Array<{ value: string }>;
    };
    expect(JSON.parse(input.metafields[0].value)).toEqual({
      productIds: [PRODUCT],
      collectionIds: [],
      message: "Fri frakt",
    });
  });

  it("creates both discounts and lets them combine", async () => {
    const { admin, calls } = createFakeAdmin([basicCreated, shippingCreated]);

    const ids = await syncCampaignDiscountsInShopify({
      admin,
      existingIds: noIds,
      offerType: "DISCOUNT_AND_FREE_SHIPPING",
      ...campaign,
    });

    expect(ids).toEqual({ shopifyDiscountId: BASIC, shopifyShippingDiscountId: SHIPPING });
    expect(basicInput(calls[0]).combinesWith.shippingDiscounts).toBe(true);
  });

  it("updates the product discount before deleting a shipping discount that is no longer wanted", async () => {
    const { admin, calls } = createFakeAdmin([basicUpdated, deleted(SHIPPING)]);

    const ids = await syncCampaignDiscountsInShopify({
      admin,
      existingIds: { shopifyDiscountId: BASIC, shopifyShippingDiscountId: SHIPPING },
      offerType: "DISCOUNT",
      ...campaign,
    });

    expect(ids).toEqual({ shopifyDiscountId: BASIC, shopifyShippingDiscountId: null });
    expect(calls[0].query).toContain("discountAutomaticBasicUpdate");
    expect(calls[1].query).toContain("discountAutomaticDelete");
    expect(calls[1].variables?.id).toBe(SHIPPING);
  });

  it("rolls back a discount it created when a later step fails", async () => {
    const { admin, calls } = createFakeAdmin([basicCreated, shippingCreateFailed, deleted(BASIC)]);

    const error = await syncCampaignDiscountsInShopify({
      admin,
      existingIds: noIds,
      offerType: "DISCOUNT_AND_FREE_SHIPPING",
      ...campaign,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(CampaignSyncError);
    expect((error as CampaignSyncError).message).toBe("Maximum automatic discounts reached.");
    expect((error as CampaignSyncError).ids).toEqual(noIds);
    expect(calls[2].query).toContain("discountAutomaticDelete");
    expect(calls[2].variables?.id).toBe(BASIC);
  });

  it("creates a new price discount when the stored one is gone from Shopify", async () => {
    const { admin, calls } = createFakeAdmin([basicUpdateFailed, existsFalse, basicCreated2]);

    const ids = await syncCampaignDiscountsInShopify({
      admin,
      existingIds: { shopifyDiscountId: BASIC, shopifyShippingDiscountId: null },
      offerType: "DISCOUNT",
      ...campaign,
    });

    expect(ids).toEqual({ shopifyDiscountId: BASIC2, shopifyShippingDiscountId: null });
    expect(calls[0].query).toContain("discountAutomaticBasicUpdate");
    expect(calls[1].query).toContain("automaticDiscountNode");
    expect(calls[1].variables?.id).toBe(BASIC);
    expect(calls[2].query).toContain("discountAutomaticBasicCreate");
  });

  it("creates a new shipping discount when the stored one is gone from Shopify", async () => {
    const { admin, calls } = createFakeAdmin([shippingUpdateFailed, existsFalse, shippingCreated2]);

    const ids = await syncCampaignDiscountsInShopify({
      admin,
      existingIds: { shopifyDiscountId: null, shopifyShippingDiscountId: SHIPPING },
      offerType: "FREE_SHIPPING",
      ...campaign,
      discountKind: null,
      discountValue: null,
    });

    expect(ids).toEqual({ shopifyDiscountId: null, shopifyShippingDiscountId: SHIPPING2 });
    expect(calls[0].query).toContain("discountAutomaticAppUpdate");
    expect(calls[1].query).toContain("automaticDiscountNode");
    expect(calls[1].variables?.id).toBe(SHIPPING);
    expect(calls[2].query).toContain("discountAutomaticAppCreate");
  });

  it("keeps the original error when an update fails but the discount still exists", async () => {
    const { admin, calls } = createFakeAdmin([basicUpdateFailed, existsTrue(BASIC)]);

    const error = await syncCampaignDiscountsInShopify({
      admin,
      existingIds: { shopifyDiscountId: BASIC, shopifyShippingDiscountId: null },
      offerType: "DISCOUNT",
      ...campaign,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(CampaignSyncError);
    expect((error as CampaignSyncError).message).toBe("Discount does not exist");
    expect((error as CampaignSyncError).ids).toEqual({
      shopifyDiscountId: BASIC,
      shopifyShippingDiscountId: null,
    });
    expect(calls).toHaveLength(2);
  });

  it("treats a shipping discount as deleted when it is already gone from Shopify", async () => {
    const { admin, calls } = createFakeAdmin([basicUpdated, deleteFailed, existsFalse]);

    const ids = await syncCampaignDiscountsInShopify({
      admin,
      existingIds: { shopifyDiscountId: BASIC, shopifyShippingDiscountId: SHIPPING },
      offerType: "DISCOUNT",
      ...campaign,
    });

    expect(ids).toEqual({ shopifyDiscountId: BASIC, shopifyShippingDiscountId: null });
    expect(calls[1].query).toContain("discountAutomaticDelete");
    expect(calls[2].query).toContain("automaticDiscountNode");
    expect(calls[2].variables?.id).toBe(SHIPPING);
  });
});

describe("deleteCampaignDiscountsInShopify", () => {
  it("deletes both discounts", async () => {
    const { admin, calls } = createFakeAdmin([deleted(BASIC), deleted(SHIPPING)]);

    await deleteCampaignDiscountsInShopify({
      admin,
      ids: { shopifyDiscountId: BASIC, shopifyShippingDiscountId: SHIPPING },
    });

    expect(calls.map((call) => call.variables?.id)).toEqual([BASIC, SHIPPING]);
  });

  it("reports the discounts that are still in Shopify when a delete fails", async () => {
    const { admin } = createFakeAdmin([deleted(BASIC), deleteFailed]);

    const error = await deleteCampaignDiscountsInShopify({
      admin,
      ids: { shopifyDiscountId: BASIC, shopifyShippingDiscountId: SHIPPING },
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(CampaignSyncError);
    expect((error as CampaignSyncError).ids).toEqual({
      shopifyDiscountId: null,
      shopifyShippingDiscountId: SHIPPING,
    });
  });

  it("continues to the next discount when a failed delete turns out to be already gone", async () => {
    const { admin, calls } = createFakeAdmin([deleteFailed, existsFalse, deleted(SHIPPING)]);

    await deleteCampaignDiscountsInShopify({
      admin,
      ids: { shopifyDiscountId: BASIC, shopifyShippingDiscountId: SHIPPING },
    });

    expect(calls[0].variables?.id).toBe(BASIC);
    expect(calls[1].query).toContain("automaticDiscountNode");
    expect(calls[1].variables?.id).toBe(BASIC);
    expect(calls[2].variables?.id).toBe(SHIPPING);
  });
});
