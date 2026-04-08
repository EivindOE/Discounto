export const PLAN_ORDER = ["FREE", "PLUS", "BUSINESS"] as const;

export type PlanTier = (typeof PLAN_ORDER)[number];

export type BillingCycle = "MONTHLY" | "YEARLY";

export type PlanDefinition = {
  tier: PlanTier;
  name: string;
  monthlyPrice: number;
  annualPrice: number | null;
  monthlyPriceLabel: string;
  annualPriceLabel: string | null;
  priceLabel: string;
  trialDays: number;
  activeProductLimit: number | null;
  activeCampaignLimit: number | null;
  canSchedule: boolean;
  canUseCollections: boolean;
  billingPlanKey: null | Exclude<PlanTier, "FREE">;
  coverageLabel: string;
  campaignLimitLabel: string;
  description: string;
};

export const plansByTier: Record<PlanTier, PlanDefinition> = {
  FREE: {
    tier: "FREE",
    name: "Free",
    monthlyPrice: 0,
    annualPrice: null,
    monthlyPriceLabel: "Free",
    annualPriceLabel: null,
    priceLabel: "Free",
    trialDays: 0,
    activeProductLimit: 10,
    activeCampaignLimit: 1,
    canSchedule: false,
    canUseCollections: false,
    billingPlanKey: null,
    coverageLabel: "Up to 10 unique active products",
    campaignLimitLabel: "1 active campaign",
    description:
      "Try Discounto on a focused set of products and validate the full admin-to-storefront flow.",
  },
  PLUS: {
    tier: "PLUS",
    name: "Plus",
    monthlyPrice: 6.9,
    annualPrice: 69,
    monthlyPriceLabel: "$6.90 / month",
    annualPriceLabel: "$69 / year",
    priceLabel: "$6.90 / month or $69 / year, 14-day trial",
    trialDays: 14,
    activeProductLimit: 50,
    activeCampaignLimit: 5,
    canSchedule: true,
    canUseCollections: true,
    billingPlanKey: "PLUS",
    coverageLabel: "Up to 50 unique active products",
    campaignLimitLabel: "Up to 5 active campaigns",
    description:
      "Run multiple campaigns with scheduling and broader storefront coverage for a growing catalog.",
  },
  BUSINESS: {
    tier: "BUSINESS",
    name: "Business",
    monthlyPrice: 19,
    annualPrice: 199,
    monthlyPriceLabel: "$19 / month",
    annualPriceLabel: "$199 / year",
    priceLabel: "$19 / month or $199 / year, 14-day trial",
    trialDays: 14,
    activeProductLimit: null,
    activeCampaignLimit: null,
    canSchedule: true,
    canUseCollections: true,
    billingPlanKey: "BUSINESS",
    coverageLabel: "Unlimited active products",
    campaignLimitLabel: "Unlimited campaigns",
    description:
      "Use Discounto across your full catalog with no campaign ceiling and no active-product cap.",
  },
};

export function getPlanActionLabel(
  plan: PlanDefinition,
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

export function formatPlanLimit(limit: number | null, singularLabel: string) {
  if (limit == null) {
    return `Unlimited ${singularLabel}`;
  }

  return `${limit} ${singularLabel}`;
}
