export const CAMPAIGN_OFFER_TYPES = [
  "DISCOUNT",
  "FREE_SHIPPING",
  "DISCOUNT_AND_FREE_SHIPPING",
] as const;
export type CampaignOfferType = (typeof CAMPAIGN_OFFER_TYPES)[number];

export const CAMPAIGN_BADGE_LAYOUTS = ["SEPARATE", "COMBINED", "DISCOUNT_ONLY"] as const;
export type CampaignBadgeLayoutType = (typeof CAMPAIGN_BADGE_LAYOUTS)[number];

export const DEFAULT_FREE_SHIPPING_BADGE_TEXT = "Free shipping";

export type ShippingFunctionConfiguration = {
  productIds: string[];
  collectionIds: string[];
  message: string;
};

export function normalizeOfferType(value: unknown): CampaignOfferType {
  const text = String(value ?? "");
  return (CAMPAIGN_OFFER_TYPES as readonly string[]).includes(text)
    ? (text as CampaignOfferType)
    : "DISCOUNT";
}

export function normalizeBadgeLayout(value: unknown): CampaignBadgeLayoutType {
  const text = String(value ?? "");
  return (CAMPAIGN_BADGE_LAYOUTS as readonly string[]).includes(text)
    ? (text as CampaignBadgeLayoutType)
    : "SEPARATE";
}

export function offerIncludesDiscount(offerType: CampaignOfferType) {
  return offerType !== "FREE_SHIPPING";
}

export function offerIncludesFreeShipping(offerType: CampaignOfferType) {
  return offerType !== "DISCOUNT";
}

export function buildShippingFunctionConfiguration({
  selectedProducts,
  selectedCollections,
  freeShippingBadgeText,
}: {
  selectedProducts: Array<{ productGid: string }>;
  selectedCollections: Array<{ collectionGid: string }>;
  freeShippingBadgeText?: string | null;
}): ShippingFunctionConfiguration {
  const trimmedBadgeText = freeShippingBadgeText?.trim();

  return {
    productIds: [...new Set(selectedProducts.map((product) => product.productGid))],
    collectionIds: [
      ...new Set(selectedCollections.map((collection) => collection.collectionGid)),
    ],
    message: trimmedBadgeText ? trimmedBadgeText : DEFAULT_FREE_SHIPPING_BADGE_TEXT,
  };
}

export function formatCampaignOfferLabel({
  offerType,
  discountKind,
  discountValue,
  currencyCode,
}: {
  offerType: CampaignOfferType;
  discountKind: "PERCENTAGE" | "FIXED_AMOUNT" | null;
  discountValue: number | null;
  currencyCode: string;
}) {
  if (offerType === "FREE_SHIPPING") {
    return "Free shipping";
  }

  const discountLabel =
    discountValue == null
      ? ""
      : discountKind === "FIXED_AMOUNT"
        ? `${discountValue} ${currencyCode}`
        : `${discountValue}%`;

  return offerType === "DISCOUNT_AND_FREE_SHIPPING"
    ? `${discountLabel} + free shipping`
    : discountLabel;
}
