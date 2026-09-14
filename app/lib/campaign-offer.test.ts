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
  it("collects unique product and collection ids and defaults the message", () => {
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
      message: "Free shipping",
    });
  });

  it("uses the campaign's trimmed free shipping badge text as the message", () => {
    expect(
      buildShippingFunctionConfiguration({
        selectedProducts: [],
        selectedCollections: [],
        freeShippingBadgeText: "  Fri frakt  ",
      }),
    ).toEqual({
      productIds: [],
      collectionIds: [],
      message: "Fri frakt",
    });
  });

  it("falls back to the default message when the badge text is empty or missing", () => {
    expect(
      buildShippingFunctionConfiguration({
        selectedProducts: [],
        selectedCollections: [],
        freeShippingBadgeText: "   ",
      }).message,
    ).toBe("Free shipping");

    expect(
      buildShippingFunctionConfiguration({
        selectedProducts: [],
        selectedCollections: [],
        freeShippingBadgeText: null,
      }).message,
    ).toBe("Free shipping");
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
