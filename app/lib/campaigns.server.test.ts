import { describe, expect, it } from "vitest";
import { parseCampaignOfferFields } from "./campaigns.server";

function form(values: Record<string, string>) {
  const formData = new FormData();
  Object.entries(values).forEach(([key, value]) => formData.set(key, value));
  return formData;
}

describe("parseCampaignOfferFields", () => {
  it("parses a discount-only campaign like before", () => {
    expect(
      parseCampaignOfferFields(
        form({ discountKind: "FIXED_AMOUNT", discountValue: "50", freeShippingBadgeText: "Fri frakt" }),
      ),
    ).toEqual({
      ok: true,
      fields: {
        offerType: "DISCOUNT",
        discountKind: "FIXED_AMOUNT",
        discountValue: 50,
        freeShippingBadgeText: null,
        badgeLayout: "SEPARATE",
      },
    });
  });

  it("rejects a missing discount value when the offer includes a discount", () => {
    expect(
      parseCampaignOfferFields(form({ offerType: "DISCOUNT_AND_FREE_SHIPPING", discountValue: "0" })),
    ).toEqual({ ok: false, error: "Enter a discount value greater than 0." });
  });

  it("stores no discount for a free-shipping-only campaign", () => {
    expect(
      parseCampaignOfferFields(
        form({ offerType: "FREE_SHIPPING", discountValue: "", freeShippingBadgeText: "  Fri frakt " }),
      ),
    ).toEqual({
      ok: true,
      fields: {
        offerType: "FREE_SHIPPING",
        discountKind: null,
        discountValue: null,
        freeShippingBadgeText: "Fri frakt",
        badgeLayout: "SEPARATE",
      },
    });
  });

  it("keeps the badge layout for a combined offer", () => {
    const result = parseCampaignOfferFields(
      form({
        offerType: "DISCOUNT_AND_FREE_SHIPPING",
        discountKind: "PERCENTAGE",
        discountValue: "10",
        freeShippingBadgeText: "",
        badgeLayout: "COMBINED",
      }),
    );

    expect(result).toEqual({
      ok: true,
      fields: {
        offerType: "DISCOUNT_AND_FREE_SHIPPING",
        discountKind: "PERCENTAGE",
        discountValue: 10,
        freeShippingBadgeText: null,
        badgeLayout: "COMBINED",
      },
    });
  });
});
