import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Card,
  DataTable,
  Button,
  InlineGrid,
  InlineStack,
  List,
  Page,
  Text,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { InternalRouteButton } from "../components/InternalRouteButton";
import { calculatePlanUsage } from "../lib/plan-usage.server";
import { listCampaignsForShop } from "../models/discount.server";
import { syncPlanFromBilling } from "../models/billing.server";
import { authenticate } from "../shopify.server";
import { PLAN_ORDER, plansByTier } from "../lib/plans";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing, admin } = await authenticate.admin(request);
  const { settings } = await syncPlanFromBilling({
    shop: session.shop,
    billing,
    admin,
  });
  const campaigns = await listCampaignsForShop(session.shop);
  const currentPlan = plansByTier[settings.plan];
  const usage = calculatePlanUsage(campaigns);

  return {
    shop: session.shop,
    settings,
    currentPlan,
    usage,
    totalCampaigns: campaigns.length,
    latestCampaigns: campaigns.slice(0, 5).map((campaign) => ({
      id: campaign.id,
      title: campaign.title,
      status: campaign.status,
      syncStatus: campaign.syncStatus,
      productCount: campaign.products.length,
      discountLabel:
        campaign.discountKind === "PERCENTAGE"
          ? `${campaign.discountValue}%`
          : `${campaign.discountValue} ${campaign.currencyCode}`,
    })),
    plans: PLAN_ORDER.map((tier) => plansByTier[tier]),
    themeEditorUrl: `https://${session.shop}/admin/themes/current/editor?context=apps`,
  };
};

export default function Dashboard() {
  const {
    currentPlan,
    usage,
    totalCampaigns,
    latestCampaigns,
    plans,
    settings,
    themeEditorUrl,
  } = useLoaderData<typeof loader>();

  return (
    <Page>
      <TitleBar title="Discounto" />
      <BlockStack gap="500">
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <BlockStack gap="100">
                <Text as="h1" variant="headingLg">
                  Create a discount and make sure shoppers actually see it
                </Text>
                <Text as="p" variant="bodyMd" tone="subdued">
                  Discounto helps you create a native Shopify automatic
                  discount and surface the savings clearly across your theme.
                </Text>
              </BlockStack>
              <Badge tone="success">{currentPlan.name}</Badge>
            </InlineStack>

            <InlineGrid columns={{ xs: 1, md: 3 }} gap="300">
              <MetricCard
                label="Active plan"
                value={currentPlan.name}
                caption={currentPlan.coverageLabel}
              />
              <MetricCard
                label="Active product coverage"
                value={`${usage.activeProductCount}`}
                caption={
                  currentPlan.activeProductLimit == null
                    ? "Unlimited product coverage"
                    : `${usage.activeProductCount} of ${currentPlan.activeProductLimit} used`
                }
              />
              <MetricCard
                label="Campaigns"
                value={`${usage.activeCampaignCount} active`}
                caption={`${totalCampaigns} total`}
              />
            </InlineGrid>

            <InlineStack gap="300" wrap>
              <InternalRouteButton
                to="/app/discounts/new"
                variant="primary"
                dataTestId="dashboard-create-discount"
              >
                Create discount
              </InternalRouteButton>
              <InternalRouteButton
                to="/app/billing"
                dataTestId="dashboard-manage-billing"
              >
                Manage billing
              </InternalRouteButton>
              <Button url={themeEditorUrl} target="_blank">
                Open theme editor
              </Button>
            </InlineStack>

            <Banner tone="info">
              <BlockStack gap="200">
                <Text as="p" variant="bodyMd" fontWeight="semibold">
                  One more step: enable Discounto in your theme.
                </Text>
                <List>
                  <List.Item>
                    Turn on the <strong>Discounto app embed</strong> to show
                    badges and pricing on collection, featured, and storefront product
                    cards.
                  </List.Item>
                  <List.Item>
                    Add the <strong>Product sale badge</strong> app block on your
                    product page template to show the campaign on the product page too.
                  </List.Item>
                </List>
                <Text as="p" variant="bodyMd" tone="subdued">
                  Customers will only see Discounto where these theme elements
                  are enabled.
                </Text>
                <InlineStack>
                  <Button url={themeEditorUrl} target="_blank">
                    Open theme editor
                  </Button>
                </InlineStack>
              </BlockStack>
            </Banner>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">
                Recent campaigns
              </Text>
              <InternalRouteButton to="/app/discounts" dataTestId="dashboard-view-all">
                View all
              </InternalRouteButton>
            </InlineStack>
            {latestCampaigns.length > 0 ? (
              <DataTable
                columnContentTypes={["text", "text", "text", "numeric", "text"]}
                headings={["Name", "Status", "Sync", "Products", "Discount"]}
                rows={latestCampaigns.map((campaign) => [
                  campaign.title,
                  campaign.status,
                  campaign.syncStatus,
                  campaign.productCount.toString(),
                  campaign.discountLabel,
                ])}
              />
            ) : (
              <Box paddingBlock="400">
                <Text as="p" variant="bodyMd" tone="subdued">
                  No campaigns yet. Create the first one to test the end-to-end
                  flow from admin to storefront.
                </Text>
              </Box>
            )}
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Plans
            </Text>
            <InlineGrid columns={{ xs: 1, md: 3 }} gap="300">
              {plans.map((plan) => (
                <Card key={plan.tier}>
                  <BlockStack gap="200">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="h3" variant="headingMd">
                        {plan.name}
                      </Text>
                      {plan.tier === settings.plan ? (
                        <Badge tone="success">Current</Badge>
                      ) : null}
                    </InlineStack>
                    <Text as="p" variant="headingLg">
                      {plan.priceLabel}
                    </Text>
                    <Text as="p" variant="bodyMd" tone="subdued">
                      {plan.description}
                    </Text>
                    <List>
                      <List.Item>{plan.coverageLabel}</List.Item>
                      <List.Item>{plan.campaignLimitLabel}</List.Item>
                      <List.Item>
                        {plan.canSchedule ? "Scheduling included" : "Scheduling on paid plans"}
                      </List.Item>
                    </List>
                  </BlockStack>
                </Card>
              ))}
            </InlineGrid>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}

function MetricCard({
  label,
  value,
  caption,
}: {
  label: string;
  value: string;
  caption: string;
}) {
  return (
    <Card>
      <BlockStack gap="100">
        <Text as="p" variant="bodySm" tone="subdued">
          {label}
        </Text>
        <Text as="p" variant="headingLg">
          {value}
        </Text>
        <Text as="p" variant="bodySm" tone="subdued">
          {caption}
        </Text>
      </BlockStack>
    </Card>
  );
}
