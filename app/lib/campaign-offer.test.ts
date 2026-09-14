import { describe, expect, it } from "vitest";
import {
  buildShippingFunctionConfiguration,
  formatCampaignOfferLabel,
  normalizeBadgeLayout,
  normalizeOfferType,
  offerIncludesDiscount,
  offerIncludesFreeShipping,
} from "./campaign-offer";

describe("normalizeOfferType", () => {
  it("keeps known offer types", () => {
    expect(normalizeOfferType("FREE_SHIPPING")).toBe("FREE_SHIPPING");
    expect(normalizeOfferType("DISCOUNT_AND_FREE_SHIPPING")).toBe("DISCOUNT_AND_FREE_SHIPPING");
  });

  it("falls back to DISCOUNT for unknown or missing values", () => {
    expect(normalizeOfferType("nope")).toBe("DISCOUNT");
    expect(normalizeOfferType(null)).toBe("DISCOUNT");
  });
});

describe("normalizeBadgeLayout", () => {
  it("keeps known layouts and falls back to SEPARATE", () => {
    expect(normalizeBadgeLayout("COMBINED")).toBe("COMBINED");
    expect(normalizeBadgeLayout(undefined)).toBe("SEPARATE");
  });
});

describe("offer parts", () => {
  it("reports which parts each offer includes", () => {
    expect(offerIncludesDiscount("DISCOUNT")).toBe(true);
    expect(offerIncludesFreeShipping("DISCOUNT")).toBe(false);
    expect(offerIncludesDiscount("FREE_SHIPPING")).toBe(false);
    expect(offerIncludesFreeShipping("FREE_SHIPPING")).toBe(true);
    expect(offerIncludesDiscount("DISCOUNT_AND_FREE_SHIPPING")).toBe(true);
    expect(offerIncludesFreeShipping("DISCOUNT_AND_FREE_SHIPPING")).toBe(true);
  });
});

describe("buildShippingFunctionConfiguration", () => {
  it("collects unique product and collection ids", () => {
    expect(
      buildShippingFunctionConfiguration({
        selectedProducts: [
          { productGid: "gid://shopify/Product/1" },
          { productGid: "gid://shopify/Product/1" },
        ],
        selectedCollections: [{ collectionGid: "gid://shopify/Collection/9" }],
      }),
    ).toEqual({
      productIds: ["gid://shopify/Product/1"],
      collectionIds: ["gid://shopify/Collection/9"],
    });
  });
});

describe("formatCampaignOfferLabel", () => {
  it("formats every offer type", () => {
    const base = { discountKind: "PERCENTAGE" as const, discountValue: 10, currencyCode: "NOK" };
    expect(formatCampaignOfferLabel({ ...base, offerType: "DISCOUNT" })).toBe("10%");
    expect(
      formatCampaignOfferLabel({ ...base, discountKind: "FIXED_AMOUNT", offerType: "DISCOUNT" }),
    ).toBe("10 NOK");
    expect(
      formatCampaignOfferLabel({
        offerType: "FREE_SHIPPING",
        discountKind: null,
        discountValue: null,
        currencyCode: "NOK",
      }),
    ).toBe("Free shipping");
    expect(formatCampaignOfferLabel({ ...base, offerType: "DISCOUNT_AND_FREE_SHIPPING" })).toBe(
      "10% + free shipping",
    );
  });
});
