import type { DiscountCampaign, DiscountProduct } from "@prisma/client";
import { plansByTier, type PlanTier } from "./plans";

type CampaignWithProducts = Pick<DiscountCampaign, "id" | "status"> & {
  products: Array<Pick<DiscountProduct, "productGid">>;
};

type UsageSummary = {
  activeCampaignCount: number;
  activeProductCount: number;
  activeProductIds: string[];
};

type PlanLimitCheck = {
  ok: boolean;
  usage: UsageSummary;
  error?: string;
};

export function calculatePlanUsage(
  campaigns: CampaignWithProducts[],
): UsageSummary {
  const activeCampaigns = campaigns.filter((campaign) => campaign.status === "ACTIVE");
  const productIds = new Set<string>();

  for (const campaign of activeCampaigns) {
    for (const product of campaign.products) {
      if (product.productGid) {
        productIds.add(product.productGid);
      }
    }
  }

  return {
    activeCampaignCount: activeCampaigns.length,
    activeProductCount: productIds.size,
    activeProductIds: [...productIds],
  };
}

export function checkPlanLimitsForCampaignChange({
  plan,
  campaigns,
  nextProducts,
  replaceCampaignId,
}: {
  plan: PlanTier;
  campaigns: CampaignWithProducts[];
  nextProducts: Array<Pick<DiscountProduct, "productGid">>;
  replaceCampaignId?: string;
}): PlanLimitCheck {
  const planConfig = plansByTier[plan];
  const retainedActiveCampaigns = campaigns.filter(
    (campaign) =>
      campaign.status === "ACTIVE" && campaign.id !== replaceCampaignId,
  );
  const projectedActiveCampaigns = [
    ...retainedActiveCampaigns,
    { id: replaceCampaignId ?? "__new__", status: "ACTIVE" as const, products: nextProducts },
  ];
  const usage = calculatePlanUsage(projectedActiveCampaigns);

  if (
    planConfig.activeCampaignLimit != null &&
    usage.activeCampaignCount > planConfig.activeCampaignLimit
  ) {
    return {
      ok: false,
      usage,
      error: `${planConfig.name} supports up to ${planConfig.activeCampaignLimit} active campaign${
        planConfig.activeCampaignLimit === 1 ? "" : "s"
      }. Archive an active campaign or upgrade in Billing.`,
    };
  }

  if (
    planConfig.activeProductLimit != null &&
    usage.activeProductCount > planConfig.activeProductLimit
  ) {
    return {
      ok: false,
      usage,
      error: `${planConfig.name} supports up to ${planConfig.activeProductLimit} unique active products across live campaigns. Reduce product coverage or upgrade in Billing.`,
    };
  }

  return {
    ok: true,
    usage,
  };
}

export function getSchedulingAccessError({
  plan,
  startsAt,
  endsAt,
}: {
  plan: PlanTier;
  startsAt: Date | null;
  endsAt: Date | null;
}) {
  const planConfig = plansByTier[plan];

  if (!planConfig.canSchedule && (startsAt || endsAt)) {
    return "Scheduling is available on Plus and Business. Upgrade in Billing to set start or end times.";
  }

  return null;
}
