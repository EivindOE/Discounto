export const PLAN_ORDER = ["FREE", "PLUS", "BUSINESS"] as const;

export const plansByTier = {
  FREE: {
    tier: "FREE",
    name: "Free",
    priceLabel: "$0 / month",
    productLimit: 10,
    billingPlanKey: null,
    productLimitLabel: "Show discount badges on up to 10 products",
    description:
      "Perfect for validating the install, discount setup, and storefront visibility flow.",
  },
  PLUS: {
    tier: "PLUS",
    name: "Plus",
    priceLabel: "$19 / month",
    productLimit: 50,
    billingPlanKey: "PLUS",
    productLimitLabel: "Show discount badges on up to 50 products",
    description:
      "Built for stores that want to run multiple campaigns without hitting the starter limit.",
  },
  BUSINESS: {
    tier: "BUSINESS",
    name: "Business",
    priceLabel: "$79 / month",
    productLimit: 999999,
    billingPlanKey: "BUSINESS",
    productLimitLabel: "Unlimited products",
    description:
      "For teams that want broad campaign coverage and no product-count ceiling.",
  },
} as const;

export type PlanTier = keyof typeof plansByTier;

export function getPlanActionLabel(
  plan: (typeof plansByTier)[PlanTier],
  currentPlan: PlanTier,
) {
  if (plan.tier === currentPlan) {
    return "Current plan";
  }

  if (plan.tier === "FREE") {
    return "Switch to Free";
  }

  return `Choose ${plan.name}`;
}
