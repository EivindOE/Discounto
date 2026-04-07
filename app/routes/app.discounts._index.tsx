import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form, useActionData, useLoaderData } from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  DataTable,
  EmptyState,
  InlineStack,
  Page,
  Text,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { InternalRouteButton } from "../components/InternalRouteButton";
import {
  calculatePlanUsage,
  checkPlanLimitsForCampaignChange,
  getSchedulingAccessError,
} from "../lib/plan-usage.server";
import { plansByTier } from "../lib/plans";
import {
  deleteCampaignById,
  getCampaignByIdForShop,
  listCampaignsForShop,
  markCampaignActive,
  markCampaignArchived,
  markCampaignSyncFailure,
} from "../models/discount.server";
import { syncPlanFromBilling } from "../models/billing.server";
import {
  createAutomaticDiscountInShopify,
  deleteAutomaticDiscountInShopify,
} from "../models/shopify-discounts.server";
import { authenticate } from "../shopify.server";

function formatSchedule(startsAt: string | null, endsAt: string | null) {
  if (!startsAt && !endsAt) {
    return "Starts immediately";
  }

  const parts: string[] = [];

  if (startsAt) {
    parts.push(`Starts ${new Date(startsAt).toLocaleString()}`);
  }

  if (endsAt) {
    parts.push(`Ends ${new Date(endsAt).toLocaleString()}`);
  }

  return parts.join(" • ");
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing, admin } = await authenticate.admin(request);
  const { settings } = await syncPlanFromBilling({
    shop: session.shop,
    billing,
    admin,
  });
  const campaigns = await listCampaignsForShop(session.shop);
  const usage = calculatePlanUsage(campaigns);
  const currentPlan = plansByTier[settings.plan];

  return {
    currentPlan,
    usage,
    campaigns: campaigns.map((campaign) => ({
      id: campaign.id,
      title: campaign.title,
      status: campaign.status,
      syncStatus: campaign.syncStatus,
      kind: campaign.discountKind,
      value: campaign.discountValue,
      currencyCode: campaign.currencyCode,
      productCount: campaign.products.length,
      badgeText: campaign.badgeText,
      lastSyncError: campaign.lastSyncError,
      startsAt: campaign.startsAt?.toISOString() ?? null,
      endsAt: campaign.endsAt?.toISOString() ?? null,
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin, billing } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");
  const campaignId = String(formData.get("campaignId") ?? "");

  if (!campaignId) {
    return { error: "Choose a campaign before continuing." };
  }

  const campaign = await getCampaignByIdForShop(session.shop, campaignId);
  if (!campaign) {
    return { error: "Campaign not found." };
  }
  const { settings } = await syncPlanFromBilling({
    shop: session.shop,
    billing,
    admin,
  });
  const campaigns = await listCampaignsForShop(session.shop);

  try {
    if (intent === "deactivate") {
      if (campaign.shopifyDiscountId) {
        await deleteAutomaticDiscountInShopify({
          admin,
          shopifyDiscountId: campaign.shopifyDiscountId,
        });
      }

      await markCampaignArchived({ campaignId });
      return redirect("/app/discounts");
    }

    if (intent === "activate") {
      const schedulingError = getSchedulingAccessError({
        plan: settings.plan,
        startsAt: campaign.startsAt,
        endsAt: campaign.endsAt,
      });

      if (schedulingError) {
        return { error: schedulingError };
      }

      const limitCheck = checkPlanLimitsForCampaignChange({
        plan: settings.plan,
        campaigns,
        replaceCampaignId: campaign.id,
        nextProducts: campaign.products,
      });

      if (!limitCheck.ok) {
        return { error: limitCheck.error };
      }

      const { shopifyDiscountId } = await createAutomaticDiscountInShopify({
        admin,
        title: campaign.title,
        discountKind: campaign.discountKind,
        discountValue: campaign.discountValue,
        selectedProducts: campaign.products,
        startsAt: campaign.startsAt,
        endsAt: campaign.endsAt,
      });

      await markCampaignActive({
        campaignId,
        shopifyDiscountId,
      });
      return redirect("/app/discounts");
    }

    if (intent === "delete") {
      if (campaign.shopifyDiscountId) {
        await deleteAutomaticDiscountInShopify({
          admin,
          shopifyDiscountId: campaign.shopifyDiscountId,
        });
      }

      await deleteCampaignById({
        campaignId,
        shop: session.shop,
      });
      return redirect("/app/discounts");
    }

    return { error: "Unsupported campaign action." };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Campaign sync failed unexpectedly.";

    await markCampaignSyncFailure({
      campaignId,
      errorMessage: message,
    });

    return { error: message };
  }
};

export default function DiscountsPage() {
  const actionData = useActionData<{ error?: string }>();
  const { campaigns, usage, currentPlan } = useLoaderData<typeof loader>();

  return (
    <Page>
      <TitleBar title="Discounts" />

      <BlockStack gap="400">
        {actionData?.error ? <Banner tone="critical">{actionData.error}</Banner> : null}

        <InlineStack align="space-between" blockAlign="center">
          <Text as="h1" variant="headingLg">
            Discount campaigns
          </Text>
          <InternalRouteButton
            to="/app/discounts/new"
            variant="primary"
            dataTestId="discounts-create-discount"
          >
            Create discount
          </InternalRouteButton>
        </InlineStack>

        <Card>
          {campaigns.length > 0 ? (
            <DataTable
              columnContentTypes={[
                "text",
                "text",
                "text",
                "numeric",
                "text",
                "text",
                "text",
                "text",
              ]}
              headings={[
                "Name",
                "Status",
                "Sync",
                "Products",
                "Discount",
                "Badge text",
                "Schedule",
                "Actions",
              ]}
              rows={campaigns.map((campaign) => [
                campaign.title,
                campaign.status,
                campaign.syncStatus,
                campaign.productCount.toString(),
                campaign.kind === "PERCENTAGE"
                  ? `${String(campaign.value)}%`
                  : `${String(campaign.value)} ${campaign.currencyCode}`,
                campaign.badgeText ?? "-",
                formatSchedule(campaign.startsAt, campaign.endsAt),
                <InlineStack key={`${campaign.id}-actions`} gap="200" wrap={false}>
                  <InternalRouteButton to={`/app/discounts/${campaign.id}`}>
                    Edit
                  </InternalRouteButton>
                  {campaign.status === "ACTIVE" ? (
                    <Form method="post">
                      <input type="hidden" name="campaignId" value={campaign.id} />
                      <input type="hidden" name="intent" value="deactivate" />
                      <Button submit>Deactivate</Button>
                    </Form>
                  ) : (
                    <Form method="post">
                      <input type="hidden" name="campaignId" value={campaign.id} />
                      <input type="hidden" name="intent" value="activate" />
                      <Button submit variant="primary">
                        Activate
                      </Button>
                    </Form>
                  )}
                  <Form method="post">
                    <input type="hidden" name="campaignId" value={campaign.id} />
                    <input type="hidden" name="intent" value="delete" />
                    <Button submit tone="critical" variant="secondary">
                      Delete
                    </Button>
                  </Form>
                </InlineStack>,
              ])}
            />
          ) : (
            <EmptyState
              heading="No discounts yet"
              image="https://cdn.shopify.com/shopifycloud/web/assets/v1/vite/client/en/assets/empty-state-D7M6E4Qx.svg"
            >
              <Text as="p" variant="bodyMd">
                Start with a focused campaign, sync it to Shopify, and then turn
                on the storefront badge in your theme editor.
              </Text>
              <div style={{ marginTop: "1rem" }}>
                <InternalRouteButton
                  to="/app/discounts/new"
                  variant="primary"
                  dataTestId="discounts-empty-create-discount"
                >
                  Create discount
                </InternalRouteButton>
              </div>
            </EmptyState>
          )}
        </Card>

        {campaigns.length > 0 ? (
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">
                Campaign health
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                {currentPlan.activeCampaignLimit == null
                  ? `${usage.activeCampaignCount} active campaigns running with unlimited product coverage.`
                  : `${usage.activeCampaignCount} of ${currentPlan.activeCampaignLimit} active campaigns used and ${usage.activeProductCount} of ${currentPlan.activeProductLimit} active products covered.`}
              </Text>
              <InlineStack gap="200">
                <Badge tone="success">
                  {`${campaigns.filter((campaign) => campaign.status === "ACTIVE").length} active`}
                </Badge>
                <Badge tone="info">
                  {`${campaigns.filter((campaign) => campaign.syncStatus === "SYNCED").length} synced`}
                </Badge>
                <Badge tone="critical">
                  {`${campaigns.filter((campaign) => campaign.syncStatus === "SYNC_FAILED").length} failed sync`}
                </Badge>
              </InlineStack>
              {campaigns.some((campaign) => campaign.lastSyncError) ? (
                <Text as="p" variant="bodySm" tone="subdued">
                  Failed syncs remain saved locally so you can retry without
                  rebuilding the campaign.
                </Text>
              ) : null}
            </BlockStack>
          </Card>
        ) : null}
      </BlockStack>
    </Page>
  );
}
