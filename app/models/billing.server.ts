import type { PlanTier } from "../lib/plans";
import { updateShopPlan } from "./shop-settings.server";

export const PAID_PLAN_KEYS = ["PLUS", "BUSINESS"] as const;

export function isTestBillingRequest() {
  return process.env.NODE_ENV !== "production";
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

  const targetPlan: PlanTier = activeSubscriptions.some(
    (subscription) => subscription.name === "BUSINESS",
  )
    ? "BUSINESS"
    : activeSubscriptions.some((subscription) => subscription.name === "PLUS")
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
