import type { DiscountKind } from "@prisma/client";
import prisma from "../db.server";

export type SelectedProductInput = {
  productGid: string;
  productTitle?: string | null;
  productHandle?: string | null;
  imageUrl?: string | null;
};

export async function listCampaignsForShop(shop: string) {
  return prisma.discountCampaign.findMany({
    where: { shop },
    include: {
      products: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  });
}

export async function getCampaignByIdForShop(shop: string, campaignId: string) {
  return prisma.discountCampaign.findFirst({
    where: {
      id: campaignId,
      shop,
    },
    include: {
      products: true,
    },
  });
}

export async function listVisibleStorefrontCampaignsForShop(shop: string, now = new Date()) {
  return prisma.discountCampaign.findMany({
    where: {
      shop,
      status: "ACTIVE",
      syncStatus: "SYNCED",
      OR: [{ startsAt: null }, { startsAt: { lte: now } }],
      AND: [{ OR: [{ endsAt: null }, { endsAt: { gt: now } }] }],
    },
    include: {
      products: true,
    },
    orderBy: {
      updatedAt: "desc",
    },
  });
}

export async function createCampaign({
  shop,
  title,
  discountKind,
  discountValue,
  badgeText,
  selectedProducts,
  startsAt,
  endsAt,
}: {
  shop: string;
  title: string;
  discountKind: DiscountKind;
  discountValue: number;
  badgeText: string | null;
  selectedProducts: SelectedProductInput[];
  startsAt?: Date | null;
  endsAt?: Date | null;
}) {
  return prisma.discountCampaign.create({
    data: {
      shop,
      title,
      status: "DRAFT",
      syncStatus: "DRAFT",
      discountKind,
      discountValue,
      badgeText,
      startsAt: startsAt ?? null,
      endsAt: endsAt ?? null,
      products: {
        create: selectedProducts.map((product) => ({
          productGid: product.productGid,
          productTitle: product.productTitle ?? null,
          productHandle: product.productHandle ?? null,
          imageUrl: product.imageUrl ?? null,
        })),
      },
    },
    include: {
      products: true,
    },
  });
}

export async function updateCampaign({
  campaignId,
  shop,
  title,
  discountKind,
  discountValue,
  badgeText,
  selectedProducts,
  startsAt,
  endsAt,
}: {
  campaignId: string;
  shop: string;
  title: string;
  discountKind: DiscountKind;
  discountValue: number;
  badgeText: string | null;
  selectedProducts: SelectedProductInput[];
  startsAt?: Date | null;
  endsAt?: Date | null;
}) {
  return prisma.discountCampaign.update({
    where: { id: campaignId },
    data: {
      title,
      discountKind,
      discountValue,
      badgeText,
      startsAt: startsAt ?? null,
      endsAt: endsAt ?? null,
      lastSyncError: null,
      products: {
        deleteMany: {},
        create: selectedProducts.map((product) => ({
          productGid: product.productGid,
          productTitle: product.productTitle ?? null,
          productHandle: product.productHandle ?? null,
          imageUrl: product.imageUrl ?? null,
        })),
      },
    },
    include: {
      products: true,
    },
  });
}

export async function markCampaignSyncSuccess({
  campaignId,
  shopifyDiscountId,
}: {
  campaignId: string;
  shopifyDiscountId: string;
}) {
  return prisma.discountCampaign.update({
    where: { id: campaignId },
    data: {
      status: "ACTIVE",
      syncStatus: "SYNCED",
      shopifyDiscountId,
      lastSyncError: null,
    },
  });
}

export async function markCampaignSyncFailure({
  campaignId,
  errorMessage,
}: {
  campaignId: string;
  errorMessage: string;
}) {
  return prisma.discountCampaign.update({
    where: { id: campaignId },
    data: {
      status: "DRAFT",
      syncStatus: "SYNC_FAILED",
      lastSyncError: errorMessage,
    },
  });
}

export async function markCampaignArchived({
  campaignId,
}: {
  campaignId: string;
}) {
  return prisma.discountCampaign.update({
    where: { id: campaignId },
    data: {
      status: "ARCHIVED",
      syncStatus: "DRAFT",
      shopifyDiscountId: null,
      lastSyncError: null,
    },
  });
}

export async function markCampaignActive({
  campaignId,
  shopifyDiscountId,
}: {
  campaignId: string;
  shopifyDiscountId: string;
}) {
  return prisma.discountCampaign.update({
    where: { id: campaignId },
    data: {
      status: "ACTIVE",
      syncStatus: "SYNCED",
      shopifyDiscountId,
      lastSyncError: null,
    },
  });
}

export async function deleteCampaignById({
  campaignId,
  shop,
}: {
  campaignId: string;
  shop: string;
}) {
  return prisma.discountCampaign.delete({
    where: { id: campaignId },
  });
}
