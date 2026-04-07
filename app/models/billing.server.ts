import type { PlanTier } from "../lib/plans";
import { updateShopPlan } from "./shop-settings.server";

export const PAID_PLAN_KEYS = ["PLUS", "BUSINESS"] as const;

export function isTestBillingRequest() {
  return process.env.NODE_ENV !== "production";
}

function normalizeSubscriptionPlanName(name: string | null | undefined): PlanTier | null {
  if (!name) {
    return null;
  }

  const normalized = name.trim().toUpperCase();

  if (normalized === "PLUS") {
    return "PLUS";
  }

  if (normalized === "BUSINESS") {
    return "BUSINESS";
  }

  if (normalized === "FREE") {
    return "FREE";
  }

  return null;
}

export async function syncPlanFromBilling({
  shop,
  billing,
}: {
  shop: string;
  billing: {
    check: (options?: {
      plans?: Array<(typeof PAID_PLAN_KEYS)[number]>;
      isTest?: boolean;
    }) => Promise<{
      appSubscriptions?: Array<{
        id: string;
        name: string;
        status?: string | null;
      }>;
    }>;
  };
}) {
  const billingState = await billing.check({
    plans: [...PAID_PLAN_KEYS],
    isTest: isTestBillingRequest(),
  });

  const activeSubscriptions =
    billingState.appSubscriptions?.filter(
      (subscription) => subscription.status === "ACTIVE",
    ) ?? [];

  console.info("[discounto/billing] Active subscriptions after billing.check", {
    shop,
    activeSubscriptions: activeSubscriptions.map((subscription) => ({
      id: subscription.id,
      name: subscription.name,
      status: subscription.status,
      normalizedPlan: normalizeSubscriptionPlanName(subscription.name),
    })),
  });

  const targetPlan: PlanTier = activeSubscriptions.some(
    (subscription) => normalizeSubscriptionPlanName(subscription.name) === "BUSINESS",
  )
    ? "BUSINESS"
    : activeSubscriptions.some(
          (subscription) => normalizeSubscriptionPlanName(subscription.name) === "PLUS",
        )
      ? "PLUS"
      : "FREE";

  const primarySubscription = activeSubscriptions[0] ?? null;

  const settings = await updateShopPlan(shop, targetPlan, {
    billingStatus: primarySubscription ? "active" : "inactive",
    activeChargeId: primarySubscription?.id ?? null,
  });

  return {
    settings,
    activeSubscriptions,
  };
}
