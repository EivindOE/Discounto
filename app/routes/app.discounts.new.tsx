import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { useActionData, useLoaderData } from "@remix-run/react";
import { CampaignEditor } from "../components/CampaignEditor";
import {
  calculatePlanUsage,
  checkPlanLimitsForCampaignChange,
  getSchedulingAccessError,
} from "../lib/plan-usage.server";
import { plansByTier } from "../lib/plans";
import {
  createCampaign,
  listCampaignsForShop,
  markCampaignSyncFailure,
  markCampaignSyncSuccess,
} from "../models/discount.server";
import { syncPlanFromBilling } from "../models/billing.server";
import { createAutomaticDiscountInShopify } from "../models/shopify-discounts.server";
import { resolveCampaignTargetProducts } from "../models/campaign-targets.server";
import { authenticate } from "../shopify.server";
import {
  normalizeDiscountKind,
  parseOptionalIsoDate,
  parseSelectedCollections,
  parseSelectedProducts,
} from "../lib/campaigns.server";

type ActionData = {
  error?: string;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing, admin } = await authenticate.admin(request);
  const { settings } = await syncPlanFromBilling({
    shop: session.shop,
    billing,
    admin,
  });
  const campaigns = await listCampaignsForShop(session.shop);
  const usage = await calculatePlanUsage({
    admin,
    campaigns,
  });
  const currentPlan = plansByTier[settings.plan];

  return {
    plan: settings.plan,
    usage,
    currentPlan,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin, billing } = await authenticate.admin(request);
  const { settings } = await syncPlanFromBilling({
    shop: session.shop,
    billing,
    admin,
  });
  const formData = await request.formData();

  const title = String(formData.get("title") ?? "").trim();
  const discountKind = normalizeDiscountKind(formData.get("discountKind"));
  const discountValue = Number(formData.get("discountValue") ?? 0);
  const badgeText = String(formData.get("badgeText") ?? "").trim();
  const selectedProducts = parseSelectedProducts(formData.get("selectedProducts"));
  const selectedCollections = parseSelectedCollections(formData.get("selectedCollections"));
  const startsAt = parseOptionalIsoDate(formData.get("startsAtUtc"));
  const endsAt = parseOptionalIsoDate(formData.get("endsAtUtc"));
  const campaigns = await listCampaignsForShop(session.shop);

  if (!title) {
    return { error: "Add a campaign name before saving." } satisfies ActionData;
  }

  if (!Number.isFinite(discountValue) || discountValue <= 0) {
    return { error: "Enter a discount value greater than 0." } satisfies ActionData;
  }

  if (selectedProducts.length === 0 && selectedCollections.length === 0) {
    return { error: "Select at least one product or collection." } satisfies ActionData;
  }

  if (startsAt && endsAt && endsAt <= startsAt) {
    return {
      error: "End date and time must be later than the start date and time.",
    } satisfies ActionData;
  }

  const schedulingError = getSchedulingAccessError({
    plan: settings.plan,
    startsAt,
    endsAt,
  });

  if (schedulingError) {
    return { error: schedulingError } satisfies ActionData;
  }

  const limitCheck = await checkPlanLimitsForCampaignChange({
    admin,
    plan: settings.plan,
    campaigns,
    nextProducts: selectedProducts,
    nextCollections: selectedCollections,
  });

  if (!limitCheck.ok) {
    return { error: limitCheck.error } satisfies ActionData;
  }

  const campaign = await createCampaign({
    shop: session.shop,
    title,
    discountKind,
    discountValue,
    badgeText: badgeText || null,
    selectedProducts,
    selectedCollections,
    startsAt,
    endsAt,
  });

  const resolvedProducts = await resolveCampaignTargetProducts({
    admin,
    selectedProducts,
    selectedCollections,
  });
  const shopifyDiscountProducts =
    selectedCollections.length > 0 && selectedProducts.length === 0
      ? selectedProducts
      : resolvedProducts;

  try {
    const { shopifyDiscountId } = await createAutomaticDiscountInShopify({
      admin,
      title,
      discountKind: campaign.discountKind,
      discountValue,
      selectedProducts: shopifyDiscountProducts,
      selectedCollections,
      startsAt,
      endsAt,
    });

    await markCampaignSyncSuccess({
      campaignId: campaign.id,
      shopifyDiscountId,
    });

    return redirect("/app/discounts");
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "An unexpected error stopped the Shopify discount sync.";

    await markCampaignSyncFailure({
      campaignId: campaign.id,
      errorMessage: message,
    });

    return {
      error: `The campaign was saved locally, but Shopify discount sync failed: ${message}`,
    } satisfies ActionData;
  }
};

export default function NewDiscountPage() {
  const { plan, usage, currentPlan } = useLoaderData<typeof loader>();
  const actionData = useActionData<ActionData>();

  return (
    <CampaignEditor
      titleBar="Create discount"
      pageTitle="Create discount"
      submitLabel="Save and sync discount"
      plan={plan}
      planConfig={currentPlan}
      usage={usage}
      actionData={actionData}
    />
  );
}
