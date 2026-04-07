import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { useActionData, useLoaderData } from "@remix-run/react";
import { CampaignEditor, toLocalDateTimeInputValue } from "../components/CampaignEditor";
import {
  calculatePlanUsage,
  checkPlanLimitsForCampaignChange,
  getSchedulingAccessError,
} from "../lib/plan-usage.server";
import { plansByTier } from "../lib/plans";
import {
  getCampaignByIdForShop,
  listCampaignsForShop,
  markCampaignSyncFailure,
  markCampaignSyncSuccess,
  updateCampaign,
} from "../models/discount.server";
import { syncPlanFromBilling } from "../models/billing.server";
import {
  createAutomaticDiscountInShopify,
  updateAutomaticDiscountInShopify,
} from "../models/shopify-discounts.server";
import { authenticate } from "../shopify.server";
import {
  normalizeDiscountKind,
  parseOptionalIsoDate,
  parseSelectedProducts,
} from "../lib/campaigns.server";

type ActionData = {
  error?: string;
};

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  const { settings } = await syncPlanFromBilling({
    shop: session.shop,
    billing,
  });

  const campaignId = params.campaignId;
  if (!campaignId) {
    throw new Response("Campaign not found", { status: 404 });
  }

  const campaign = await getCampaignByIdForShop(session.shop, campaignId);
  if (!campaign) {
    throw new Response("Campaign not found", { status: 404 });
  }
  const campaigns = await listCampaignsForShop(session.shop);
  const usage = calculatePlanUsage(campaigns);
  const currentPlan = plansByTier[settings.plan];

  return {
    plan: settings.plan,
    usage,
    currentPlan,
    campaign: {
      id: campaign.id,
      title: campaign.title,
      discountKind: campaign.discountKind,
      discountValue: String(campaign.discountValue),
      badgeText: campaign.badgeText ?? "",
      startsAtLocal: toLocalDateTimeInputValue(campaign.startsAt?.toISOString() ?? null),
      endsAtLocal: toLocalDateTimeInputValue(campaign.endsAt?.toISOString() ?? null),
      selectedProducts: campaign.products.map((product) => ({
        productGid: product.productGid,
        productTitle: product.productTitle,
        productHandle: product.productHandle,
        imageUrl: product.imageUrl,
      })),
    },
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session, admin, billing } = await authenticate.admin(request);
  const { settings } = await syncPlanFromBilling({
    shop: session.shop,
    billing,
  });

  const campaignId = params.campaignId;
  if (!campaignId) {
    throw new Response("Campaign not found", { status: 404 });
  }

  const existingCampaign = await getCampaignByIdForShop(session.shop, campaignId);
  if (!existingCampaign) {
    throw new Response("Campaign not found", { status: 404 });
  }

  const formData = await request.formData();
  const title = String(formData.get("title") ?? "").trim();
  const discountKind = normalizeDiscountKind(formData.get("discountKind"));
  const discountValue = Number(formData.get("discountValue") ?? 0);
  const badgeText = String(formData.get("badgeText") ?? "").trim();
  const selectedProducts = parseSelectedProducts(formData.get("selectedProducts"));
  const startsAt = parseOptionalIsoDate(formData.get("startsAtUtc"));
  const endsAt = parseOptionalIsoDate(formData.get("endsAtUtc"));
  const campaigns = await listCampaignsForShop(session.shop);

  if (!title) {
    return { error: "Add a campaign name before saving." } satisfies ActionData;
  }

  if (!Number.isFinite(discountValue) || discountValue <= 0) {
    return { error: "Enter a discount value greater than 0." } satisfies ActionData;
  }

  if (selectedProducts.length === 0) {
    return { error: "Select at least one product." } satisfies ActionData;
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

  const limitCheck = checkPlanLimitsForCampaignChange({
    plan: settings.plan,
    campaigns,
    replaceCampaignId: existingCampaign.id,
    nextProducts: selectedProducts,
  });

  if (!limitCheck.ok) {
    return { error: limitCheck.error } satisfies ActionData;
  }

  const campaign = await updateCampaign({
    campaignId,
    shop: session.shop,
    title,
    discountKind,
    discountValue,
    badgeText: badgeText || null,
    selectedProducts,
    startsAt,
    endsAt,
  });

  try {
    const syncResult = existingCampaign.shopifyDiscountId
      ? await updateAutomaticDiscountInShopify({
          admin,
          shopifyDiscountId: existingCampaign.shopifyDiscountId,
          title,
          discountKind,
          discountValue,
          selectedProducts,
          startsAt,
          endsAt,
        })
      : await createAutomaticDiscountInShopify({
          admin,
          title,
          discountKind,
          discountValue,
          selectedProducts,
          startsAt,
          endsAt,
        });

    await markCampaignSyncSuccess({
      campaignId: campaign.id,
      shopifyDiscountId: syncResult.shopifyDiscountId,
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
      error: `The campaign was updated locally, but Shopify discount sync failed: ${message}`,
    } satisfies ActionData;
  }
};

export default function EditDiscountPage() {
  const { plan, usage, currentPlan, campaign } = useLoaderData<typeof loader>();
  const actionData = useActionData<ActionData>();

  return (
    <CampaignEditor
      titleBar="Edit discount"
      pageTitle="Edit discount"
      submitLabel="Save changes"
      plan={plan}
      planConfig={currentPlan}
      usage={usage}
      initialValues={campaign}
      actionData={actionData}
    />
  );
}
