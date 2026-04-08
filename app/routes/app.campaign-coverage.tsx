import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  calculatePlanUsageSafely,
  getCollectionAccessError,
} from "../lib/plan-usage.server";
import { plansByTier } from "../lib/plans";
import { parseSelectedCollections, parseSelectedProducts } from "../lib/campaigns.server";
import { listCampaignsForShop } from "../models/discount.server";
import { resolveCampaignTargetProducts } from "../models/campaign-targets.server";
import { syncPlanFromBilling } from "../models/billing.server";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin, billing } = await authenticate.admin(request);
  const { settings } = await syncPlanFromBilling({
    shop: session.shop,
    billing,
    admin,
  });
  const formData = await request.formData();
  const selectedProducts = parseSelectedProducts(formData.get("selectedProducts"));
  const selectedCollections = parseSelectedCollections(formData.get("selectedCollections"));
  const replaceCampaignId = String(formData.get("replaceCampaignId") ?? "").trim() || undefined;
  const campaigns = await listCampaignsForShop(session.shop);
  const usage = await calculatePlanUsageSafely({
    admin,
    campaigns,
    context: "campaign coverage action",
  });
  const collectionAccessError = getCollectionAccessError({
    plan: settings.plan,
    selectedCollections,
  });

  if (collectionAccessError) {
    return json({
      ok: true,
      canUseCollections: false,
      selectedProductCount: selectedProducts.length,
      selectedCollectionCount: 0,
      projectedCampaignCoverageCount: selectedProducts.length,
      usage,
      coverageMessage: collectionAccessError,
      collectionResolutionFailed: false,
    });
  }

  try {
    const resolvedProducts = await resolveCampaignTargetProducts({
      admin,
      selectedProducts,
      selectedCollections,
    });

    return json({
      ok: true,
      canUseCollections: plansByTier[settings.plan].canUseCollections,
      selectedProductCount: selectedProducts.length,
      selectedCollectionCount: selectedCollections.length,
      projectedCampaignCoverageCount: resolvedProducts.length,
      usage,
      replaceCampaignId,
      collectionResolutionFailed: false,
    });
  } catch (error) {
    console.error("[discounto/coverage] Failed to resolve live collection membership in campaign coverage action", {
      error,
      shop: session.shop,
    });

    return json({
      ok: true,
      canUseCollections: plansByTier[settings.plan].canUseCollections,
      selectedProductCount: selectedProducts.length,
      selectedCollectionCount: selectedCollections.length,
      projectedCampaignCoverageCount: selectedProducts.length,
      usage,
      replaceCampaignId,
      coverageMessage:
        "Live collection coverage could not be loaded right now. Final validation will still run when you save.",
      collectionResolutionFailed: true,
    });
  }
};

