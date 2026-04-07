import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form, useActionData, useLoaderData } from "@remix-run/react";
import { BillingInterval } from "@shopify/shopify-app-remix/server";
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
  type BillingCycle,
  getPlanActionLabel,
  type PlanTier,
  plansByTier,
} from "../lib/plans";
import {
  isTestBillingRequest,
  syncPlanFromBilling,
} from "../models/billing.server";
import { updateShopPlan } from "../models/shop-settings.server";
import { authenticate } from "../shopify.server";

function getBillingCycleForSubscription(
  subscription?: {
    name: string;
    lineItems?: Array<{
      plan?: {
        pricingDetails?: {
          interval?: string;
        };
      };
    }>;
  } | null,
): BillingCycle | null {
  const interval = subscription?.lineItems?.[0]?.plan?.pricingDetails?.interval;

  if (interval === BillingInterval.Annual) {
    return "YEARLY";
  }

  if (interval === BillingInterval.Every30Days) {
    return "MONTHLY";
  }

  return null;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  const { settings, activeSubscriptions } = await syncPlanFromBilling({
    shop: session.shop,
    billing,
  });
  const currentSubscription =
    activeSubscriptions.find((subscription) => subscription.name === settings.plan) ??
    activeSubscriptions[0] ??
    null;

  return {
    currentPlan: settings.plan,
    currentBillingCycle: getBillingCycleForSubscription(currentSubscription),
    activeSubscriptions,
    plans: PLAN_ORDER.map((tier) => plansByTier[tier]),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  const formData = await request.formData();
  const requestedPlan = String(formData.get("plan") ?? "") as PlanTier;
  const billingCycle = String(formData.get("billingCycle") ?? "MONTHLY") as BillingCycle;

  if (!PLAN_ORDER.includes(requestedPlan)) {
    return {
      error: "Choose a valid plan before continuing.",
    };
  }

  if (billingCycle !== "MONTHLY" && billingCycle !== "YEARLY") {
    return {
      error: "Choose a valid billing cycle before continuing.",
    };
  }

  const { settings, activeSubscriptions } = await syncPlanFromBilling({
    shop: session.shop,
    billing,
  });
  const currentSubscription =
    activeSubscriptions.find((subscription) => subscription.name === requestedPlan) ??
    activeSubscriptions[0] ??
    null;
  const currentBillingCycle = getBillingCycleForSubscription(currentSubscription);

  if (requestedPlan === settings.plan && currentBillingCycle === billingCycle) {
    return {
      success: `You are already on the ${plansByTier[requestedPlan].name} plan.`,
    };
  }

  if (requestedPlan === "FREE") {
    if (activeSubscriptions[0]) {
      await billing.cancel({
        subscriptionId: activeSubscriptions[0].id,
        isTest: isTestBillingRequest(),
        prorate: false,
      });
    }

    await updateShopPlan(session.shop, "FREE", {
      billingStatus: "inactive",
      activeChargeId: null,
    });

    return redirect("/app/billing");
  }

  const plan = plansByTier[requestedPlan];
  const amount =
    billingCycle === "YEARLY" ? plan.annualPrice ?? plan.monthlyPrice : plan.monthlyPrice;
  const interval =
    billingCycle === "YEARLY" ? BillingInterval.Annual : BillingInterval.Every30Days;

  return billing.request({
    plan: requestedPlan,
    isTest: isTestBillingRequest(),
    returnUrl: `${process.env.SHOPIFY_APP_URL}/app/billing`,
    trialDays: plan.trialDays,
    lineItems: [
      {
        amount,
        currencyCode: "USD",
        interval,
      },
    ],
  });
};

export default function BillingPage() {
  const { currentPlan, currentBillingCycle, plans } = useLoaderData<typeof loader>();
  const actionData = useActionData<{ error?: string; success?: string }>();

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
            {actionData?.error ? <Banner tone="critical">{actionData.error}</Banner> : null}
            {actionData?.success ? <Banner tone="success">{actionData.success}</Banner> : null}
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
                  <List.Item>{plan.coverageLabel}</List.Item>
                  <List.Item>{plan.campaignLimitLabel}</List.Item>
                  <List.Item>
                    {plan.canSchedule ? "Scheduling included" : "Scheduling on paid plans"}
                  </List.Item>
                  <List.Item>Native Shopify automatic discount sync</List.Item>
                  <List.Item>Theme badge visibility controls</List.Item>
                </List>
                {plan.tier === "FREE" ? (
                  <Form method="post">
                    <input type="hidden" name="plan" value={plan.tier} />
                    <Button
                      submit
                      variant={plan.tier === currentPlan ? "secondary" : "primary"}
                      disabled={plan.tier === currentPlan}
                    >
                      {getPlanActionLabel(plan, currentPlan)}
                    </Button>
                  </Form>
                ) : (
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" tone="subdued">
                      14-day trial on both billing cycles.
                    </Text>
                    <InlineStack gap="200">
                      <Form method="post">
                        <input type="hidden" name="plan" value={plan.tier} />
                        <input type="hidden" name="billingCycle" value="MONTHLY" />
                        <Button
                          submit
                          variant={
                            plan.tier === currentPlan && currentBillingCycle === "MONTHLY"
                              ? "secondary"
                              : "primary"
                          }
                          disabled={
                            plan.tier === currentPlan && currentBillingCycle === "MONTHLY"
                          }
                        >
                          {plan.monthlyPriceLabel}
                        </Button>
                      </Form>
                      {plan.annualPriceLabel ? (
                        <Form method="post">
                          <input type="hidden" name="plan" value={plan.tier} />
                          <input type="hidden" name="billingCycle" value="YEARLY" />
                          <Button
                            submit
                            variant={
                              plan.tier === currentPlan && currentBillingCycle === "YEARLY"
                                ? "secondary"
                                : "primary"
                            }
                            disabled={
                              plan.tier === currentPlan && currentBillingCycle === "YEARLY"
                            }
                          >
                            {plan.annualPriceLabel}
                          </Button>
                        </Form>
                      ) : null}
                    </InlineStack>
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
