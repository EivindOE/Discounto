import type { PlanTier } from "../lib/plans";
import { plansByTier } from "../lib/plans";
import prisma from "../db.server";

export async function getOrCreateShopSettings(shop: string) {
  const existing = await prisma.shopSettings.findUnique({
    where: { shop },
  });

  if (existing) {
    return existing;
  }

  return prisma.shopSettings.create({
    data: {
      shop,
      plan: "FREE",
      productLimit: plansByTier.FREE.activeProductLimit ?? 10,
      billingStatus: "inactive",
    },
  });
}

export async function updateShopPlan(
  shop: string,
  plan: PlanTier,
  options?: {
    billingStatus?: string;
    activeChargeId?: string | null;
  },
) {
  return prisma.shopSettings.upsert({
    where: { shop },
    update: {
      plan,
      productLimit: plansByTier[plan].activeProductLimit ?? 999999,
      ...(options?.billingStatus ? { billingStatus: options.billingStatus } : {}),
      ...(options?.activeChargeId !== undefined
        ? { activeChargeId: options.activeChargeId }
        : {}),
    },
    create: {
      shop,
      plan,
      productLimit: plansByTier[plan].activeProductLimit ?? 999999,
      billingStatus: options?.billingStatus ?? "inactive",
      activeChargeId: options?.activeChargeId ?? null,
    },
  });
}
