import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  InlineGrid,
  InlineStack,
  List,
  Page,
  Text,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import {
  PLAN_ORDER,
  plansByTier,
} from "../lib/plans";
import { syncPlanFromBilling } from "../models/billing.server";
import { authenticate } from "../shopify.server";

function getManagedPricingUrl(shop: string) {
  const storeHandle = shop.replace(".myshopify.com", "");
  const appHandle =
    process.env.SHOPIFY_ADMIN_APP_HANDLE ||
    process.env.SHOPIFY_MANAGED_PRICING_APP_HANDLE ||
    "better-discounts-2";

  return `https://admin.shopify.com/store/${storeHandle}/charges/${appHandle}/pricing_plans`;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing, admin } = await authenticate.admin(request);
  const { settings, activeSubscriptions } = await syncPlanFromBilling({
    shop: session.shop,
    billing,
    admin,
  });

  return {
    currentPlan: settings.plan,
    activeSubscriptions,
    plans: PLAN_ORDER.map((tier) => plansByTier[tier]),
    managedPricingUrl: getManagedPricingUrl(session.shop),
  };
};

export default function BillingPage() {
  const { currentPlan, plans, managedPricingUrl } = useLoaderData<typeof loader>();

  const planFeatures: Record<(typeof plans)[number]["tier"], string[]> = {
    FREE: [
      "Up to 10 active products",
      "1 active campaign",
      "Product-based campaigns",
      "Storefront badges and savings",
    ],
    PLUS: [
      "Up to 50 active products",
      "Up to 5 active campaigns",
      "Collection campaigns",
      "Campaign scheduling",
      "Storefront badges and savings",
    ],
    BUSINESS: [
      "Unlimited active products",
      "Unlimited campaigns",
      "Collection campaigns",
      "Campaign scheduling",
      "Full storefront coverage",
    ],
  };

  return (
    <Page>
      <TitleBar title="Billing" />

      <BlockStack gap="400">
        <Card>
          <BlockStack gap="200">
            <Text as="h1" variant="headingLg">
              Simple plan-based billing
            </Text>
            <Text as="p" variant="bodyMd" tone="subdued">
              Discounto uses plan-based limits so the number of products in
              your campaigns stays aligned with your subscription.
            </Text>
            <Banner tone="info">
              Shopify hosts plan selection for Discounto. Billing changes,
              trials, upgrades, downgrades, and annual options are managed on
              the Shopify pricing page.
            </Banner>
          </BlockStack>
        </Card>

        <InlineGrid columns={{ xs: 1, md: 3 }} gap="300">
          {plans.map((plan) => (
            <Card key={plan.tier}>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">
                    {plan.name}
                  </Text>
                  {plan.tier === currentPlan ? <Badge tone="success">Current</Badge> : null}
                </InlineStack>
                <Text as="p" variant="headingLg">
                  {plan.priceLabel}
                </Text>
                <Text as="p" variant="bodyMd" tone="subdued">
                  {plan.description}
                </Text>
                <List>
                  {planFeatures[plan.tier].map((feature) => (
                    <List.Item key={feature}>{feature}</List.Item>
                  ))}
                </List>
                {plan.tier === "FREE" ? (
                  <Button
                    url={managedPricingUrl}
                    target="_top"
                    variant={plan.tier === currentPlan ? "secondary" : "primary"}
                    disabled={plan.tier === currentPlan}
                  >
                    {plan.tier === currentPlan ? "Current plan" : "Manage in Shopify"}
                  </Button>
                ) : (
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" tone="subdued">
                      Open Shopify's hosted plan picker to choose monthly or
                      yearly billing for this plan.
                    </Text>
                    <Button
                      url={managedPricingUrl}
                      target="_top"
                      variant={plan.tier === currentPlan ? "secondary" : "primary"}
                      disabled={plan.tier === currentPlan}
                    >
                      {plan.tier === currentPlan ? "Current plan" : `Choose ${plan.name}`}
                    </Button>
                  </BlockStack>
                )}
              </BlockStack>
            </Card>
          ))}
        </InlineGrid>
      </BlockStack>
    </Page>
  );
}
