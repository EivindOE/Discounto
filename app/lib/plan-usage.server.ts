import { plansByTier, type PlanTier } from "./plans";
import {
  buildExplicitCoverageFallbackMap,
  buildEffectiveCoverageMap,
  type AdminGraphqlClient,
} from "../models/campaign-targets.server";
import type {
  SelectedCollectionInput,
  SelectedProductInput,
} from "../models/discount.server";

type CampaignWithTargets = {
  id: string;
  status: "ACTIVE" | "DRAFT" | "ARCHIVED";
  products: Array<{ productGid: string }>;
  collections: Array<{ collectionGid: string }>;
};

type UsageSummary = {
  activeCampaignCount: number;
  activeProductCount: number;
  activeProductIds: string[];
};

type PlanLimitCheck = {
  ok: boolean;
  usage: UsageSummary;
  projectedCampaignProductCount: number;
  error?: string;
};

function summarizeUsage({
  campaigns,
  coverageMap,
}: {
  campaigns: CampaignWithTargets[];
  coverageMap: Map<string, Array<{ productGid: string }>>;
}): UsageSummary {
  const activeCampaigns = campaigns.filter((campaign) => campaign.status === "ACTIVE");
  const productIds = new Set<string>();

  for (const campaign of activeCampaigns) {
    const coverage = coverageMap.get(campaign.id) ?? [];

    for (const product of coverage) {
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

export async function calculatePlanUsage({
  admin,
  campaigns,
}: {
  admin: AdminGraphqlClient;
  campaigns: CampaignWithTargets[];
}): Promise<UsageSummary> {
  const coverageMap = await buildEffectiveCoverageMap({
    admin,
    campaigns,
  });

  return summarizeUsage({
    campaigns,
    coverageMap,
  });
}

export async function calculatePlanUsageSafely({
  admin,
  campaigns,
  context,
}: {
  admin: AdminGraphqlClient;
  campaigns: CampaignWithTargets[];
  context: string;
}): Promise<UsageSummary> {
  try {
    return await calculatePlanUsage({
      admin,
      campaigns,
    });
  } catch (error) {
    console.error(`[discounto/coverage] Falling back to explicit product usage in ${context}`, {
      error,
    });

    return summarizeUsage({
      campaigns,
      coverageMap: buildExplicitCoverageFallbackMap({ campaigns }),
    });
  }
}

export async function buildEffectiveCoverageMapSafely({
  admin,
  campaigns,
  context,
}: {
  admin: AdminGraphqlClient;
  campaigns: CampaignWithTargets[];
  context: string;
}) {
  try {
    return await buildEffectiveCoverageMap({
      admin,
      campaigns,
    });
  } catch (error) {
    console.error(`[discounto/coverage] Falling back to explicit product coverage in ${context}`, {
      error,
    });

    return buildExplicitCoverageFallbackMap({ campaigns });
  }
}

export async function checkPlanLimitsForCampaignChange({
  admin,
  plan,
  campaigns,
  nextProducts,
  nextCollections,
  replaceCampaignId,
}: {
  admin: AdminGraphqlClient;
  plan: PlanTier;
  campaigns: CampaignWithTargets[];
  nextProducts: Array<SelectedProductInput | { productGid: string }>;
  nextCollections: Array<SelectedCollectionInput | { collectionGid: string }>;
  replaceCampaignId?: string;
}): Promise<PlanLimitCheck> {
  const planConfig = plansByTier[plan];
  const retainedActiveCampaigns = campaigns.filter(
    (campaign) => campaign.status === "ACTIVE" && campaign.id !== replaceCampaignId,
  );
  const projectedCampaigns = [
    ...retainedActiveCampaigns,
    {
      id: replaceCampaignId ?? "__new__",
      status: "ACTIVE" as const,
      products: nextProducts,
      collections: nextCollections,
    },
  ];

  const coverageMap = await buildEffectiveCoverageMap({
    admin,
    campaigns: projectedCampaigns,
  });
  const usage = summarizeUsage({
    campaigns: projectedCampaigns,
    coverageMap,
  });
  const projectedCampaignProductCount =
    coverageMap.get(replaceCampaignId ?? "__new__")?.length ?? 0;

  if (
    planConfig.activeCampaignLimit != null &&
    usage.activeCampaignCount > planConfig.activeCampaignLimit
  ) {
    return {
      ok: false,
      usage,
      projectedCampaignProductCount,
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
      projectedCampaignProductCount,
      error: `${planConfig.name} supports up to ${planConfig.activeProductLimit} unique active products across live campaigns. Reduce product or collection coverage, or upgrade in Billing.`,
    };
  }

  return {
    ok: true,
    usage,
    projectedCampaignProductCount,
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
