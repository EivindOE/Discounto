import { plansByTier, type PlanTier } from "./plans";
import {
  buildExplicitCoverageFallbackMap,
  buildEffectiveCoverageMap,
  createCollectionResolutionCache,
  type AdminGraphqlClient,
  type CollectionResolutionCache,
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
  cache,
}: {
  admin: AdminGraphqlClient;
  campaigns: CampaignWithTargets[];
  cache?: CollectionResolutionCache;
}): Promise<UsageSummary> {
  const coverageMap = await buildEffectiveCoverageMap({
    admin,
    campaigns,
    cache,
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
  cache,
}: {
  admin: AdminGraphqlClient;
  campaigns: CampaignWithTargets[];
  context: string;
  cache?: CollectionResolutionCache;
}): Promise<UsageSummary> {
  try {
    return await calculatePlanUsage({
      admin,
      campaigns,
      cache,
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

/**
 * Builds the coverage map and the usage summary from a single resolution pass.
 * Callers that need both must use this: running the two lookups separately
 * doubles the Shopify query cost and gets the second one throttled, which used
 * to surface as "0 products" on collection campaigns.
 */
export async function buildCoverageAndUsageSafely({
  admin,
  campaigns,
  context,
  cache = createCollectionResolutionCache(),
}: {
  admin: AdminGraphqlClient;
  campaigns: CampaignWithTargets[];
  context: string;
  cache?: CollectionResolutionCache;
}): Promise<{
  coverageMap: Map<string, Array<{ productGid: string }>>;
  usage: UsageSummary;
  coverageResolutionFailed: boolean;
}> {
  try {
    const coverageMap = await buildEffectiveCoverageMap({
      admin,
      campaigns,
      cache,
    });

    return {
      coverageMap,
      usage: summarizeUsage({ campaigns, coverageMap }),
      coverageResolutionFailed: false,
    };
  } catch (error) {
    console.error(`[discounto/coverage] Falling back to explicit product coverage in ${context}`, {
      error,
    });

    const coverageMap = buildExplicitCoverageFallbackMap({ campaigns });

    return {
      coverageMap,
      usage: summarizeUsage({ campaigns, coverageMap }),
      coverageResolutionFailed: true,
    };
  }
}

export async function checkPlanLimitsForCampaignChange({
  admin,
  plan,
  campaigns,
  nextProducts,
  nextCollections,
  replaceCampaignId,
  cache,
}: {
  admin: AdminGraphqlClient;
  plan: PlanTier;
  campaigns: CampaignWithTargets[];
  nextProducts: Array<SelectedProductInput | { productGid: string }>;
  nextCollections: Array<SelectedCollectionInput | { collectionGid: string }>;
  replaceCampaignId?: string;
  cache?: CollectionResolutionCache;
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
    cache,
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

export function getCollectionAccessError({
  plan,
  selectedCollections,
}: {
  plan: PlanTier;
  selectedCollections: Array<SelectedCollectionInput | { collectionGid: string }>;
}) {
  const planConfig = plansByTier[plan];

  if (!planConfig.canUseCollections && selectedCollections.length > 0) {
    return "Collection campaigns are available on Plus and Business. Upgrade in Billing to target collections.";
  }

  return null;
}
