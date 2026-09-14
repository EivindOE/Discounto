import { describe, expect, it } from "vitest";
import { createFakeAdmin } from "../test/fake-admin";
import {
  automaticDiscountExistsInShopify,
  createAutomaticDiscountInShopify,
  createShippingDiscountInShopify,
  updateShippingDiscountInShopify,
} from "./shopify-discounts.server";

const configuration = {
  productIds: ["gid://shopify/Product/1"],
  collectionIds: [],
  message: "Free shipping",
};

const basicCreated = {
  data: {
    discountAutomaticBasicCreate: {
      automaticDiscountNode: { id: "gid://shopify/DiscountAutomaticNode/10" },
      userErrors: [],
    },
  },
};

describe("createAutomaticDiscountInShopify", () => {
  it("keeps shipping discounts uncombinable by default", async () => {
    const { admin, calls } = createFakeAdmin([basicCreated]);

    await createAutomaticDiscountInShopify({
      admin,
      title: "Summer",
      discountKind: "PERCENTAGE",
      discountValue: 10,
      selectedProducts: [{ productGid: "gid://shopify/Product/1" }],
    });

    const input = calls[0].variables?.automaticBasicDiscount as {
      combinesWith: { shippingDiscounts: boolean };
    };
    expect(input.combinesWith.shippingDiscounts).toBe(false);
  });

  it("lets the discount combine with shipping discounts when asked", async () => {
    const { admin, calls } = createFakeAdmin([basicCreated]);

    await createAutomaticDiscountInShopify({
      admin,
      title: "Summer",
      discountKind: "PERCENTAGE",
      discountValue: 10,
      selectedProducts: [{ productGid: "gid://shopify/Product/1" }],
      combinesWithShippingDiscounts: true,
    });

    const input = calls[0].variables?.automaticBasicDiscount as {
      combinesWith: { shippingDiscounts: boolean };
    };
    expect(input.combinesWith.shippingDiscounts).toBe(true);
  });
});

describe("createShippingDiscountInShopify", () => {
  it("creates a shipping-only app discount carrying the function configuration", async () => {
    const { admin, calls } = createFakeAdmin([
      {
        data: {
          discountAutomaticAppCreate: {
            automaticAppDiscount: { discountId: "gid://shopify/DiscountAutomaticNode/20" },
            userErrors: [],
          },
        },
      },
    ]);

    const result = await createShippingDiscountInShopify({
      admin,
      title: "Summer",
      configuration,
      startsAt: new Date("2026-09-15T08:00:00.000Z"),
      endsAt: null,
    });

    expect(result).toEqual({ shopifyDiscountId: "gid://shopify/DiscountAutomaticNode/20" });
    expect(calls[0].query).toContain("discountAutomaticAppCreate");
    expect(calls[0].variables?.automaticAppDiscount).toEqual({
      title: "Summer",
      startsAt: "2026-09-15T08:00:00.000Z",
      functionHandle: "discounto-free-shipping",
      discountClasses: ["SHIPPING"],
      combinesWith: {
        orderDiscounts: false,
        productDiscounts: true,
        shippingDiscounts: false,
      },
      metafields: [
        {
          namespace: "$app",
          key: "function-configuration",
          type: "json",
          value: JSON.stringify(configuration),
        },
      ],
    });
  });

  it("throws Shopify's user error message", async () => {
    const { admin } = createFakeAdmin([
      {
        data: {
          discountAutomaticAppCreate: {
            automaticAppDiscount: null,
            userErrors: [{ message: "Maximum automatic discounts reached." }],
          },
        },
      },
    ]);

    await expect(
      createShippingDiscountInShopify({ admin, title: "Summer", configuration }),
    ).rejects.toThrow("Maximum automatic discounts reached.");
  });
});

describe("updateShippingDiscountInShopify", () => {
  it("updates the discount and then rewrites the configuration metafield", async () => {
    const { admin, calls } = createFakeAdmin([
      {
        data: {
          discountAutomaticAppUpdate: {
            automaticAppDiscount: { discountId: "gid://shopify/DiscountAutomaticNode/20" },
            userErrors: [],
          },
        },
      },
      {
        data: {
          metafieldsSet: { metafields: [{ id: "gid://shopify/Metafield/1" }], userErrors: [] },
        },
      },
    ]);

    const result = await updateShippingDiscountInShopify({
      admin,
      shopifyDiscountId: "gid://shopify/DiscountAutomaticNode/20",
      title: "Summer v2",
      configuration,
    });

    expect(result).toEqual({ shopifyDiscountId: "gid://shopify/DiscountAutomaticNode/20" });
    expect(calls[0].query).toContain("discountAutomaticAppUpdate");
    expect(calls[0].variables?.id).toBe("gid://shopify/DiscountAutomaticNode/20");
    expect(calls[0].variables?.automaticAppDiscount).not.toHaveProperty("functionHandle");
    expect(calls[1].query).toContain("metafieldsSet");
    expect(calls[1].variables?.metafields).toEqual([
      {
        ownerId: "gid://shopify/DiscountAutomaticNode/20",
        namespace: "$app",
        key: "function-configuration",
        type: "json",
        value: JSON.stringify(configuration),
      },
    ]);
  });
});

describe("automaticDiscountExistsInShopify", () => {
  it("returns true when Shopify still has the discount", async () => {
    const { admin, calls } = createFakeAdmin([
      { data: { automaticDiscountNode: { id: "gid://shopify/DiscountAutomaticNode/20" } } },
    ]);

    const exists = await automaticDiscountExistsInShopify({
      admin,
      shopifyDiscountId: "gid://shopify/DiscountAutomaticNode/20",
    });

    expect(exists).toBe(true);
    expect(calls[0].variables?.id).toBe("gid://shopify/DiscountAutomaticNode/20");
  });

  it("returns false when the discount is gone", async () => {
    const { admin } = createFakeAdmin([{ data: { automaticDiscountNode: null } }]);

    const exists = await automaticDiscountExistsInShopify({
      admin,
      shopifyDiscountId: "gid://shopify/DiscountAutomaticNode/20",
    });

    expect(exists).toBe(false);
  });

  it("throws on a top-level GraphQL error", async () => {
    const { admin } = createFakeAdmin([{ errors: [{ message: "Throttled" }] }]);

    await expect(
      automaticDiscountExistsInShopify({
        admin,
        shopifyDiscountId: "gid://shopify/DiscountAutomaticNode/20",
      }),
    ).rejects.toThrow("Throttled");
  });
});
