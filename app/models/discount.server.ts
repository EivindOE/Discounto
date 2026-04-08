import type { DiscountKind } from "@prisma/client";
import prisma from "../db.server";

export type SelectedProductInput = {
  productGid: string;
  productTitle?: string | null;
  productHandle?: string | null;
  imageUrl?: string | null;
};

export type SelectedCollectionInput = {
  collectionGid: string;
  collectionTitle?: string | null;
  collectionHandle?: string | null;
  imageUrl?: string | null;
};

export type CampaignRecord = {
  id: string;
  shop: string;
  title: string;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  syncStatus: "DRAFT" | "SYNCED" | "SYNC_FAILED";
  discountKind: DiscountKind;
  discountValue: number;
  currencyCode: string;
  badgeText: string | null;
  shopifyDiscountId: string | null;
  lastSyncError: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  products: SelectedProductInput[];
  collections: SelectedCollectionInput[];
};

export async function listCampaignsForShop(shop: string): Promise<CampaignRecord[]> {
  return (await prisma.discountCampaign.findMany({
    where: { shop },
    include: {
      products: true,
      collections: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  } as never)) as CampaignRecord[];
}

export async function getCampaignByIdForShop(
  shop: string,
  campaignId: string,
): Promise<CampaignRecord | null> {
  return (await prisma.discountCampaign.findFirst({
    where: {
      id: campaignId,
      shop,
    },
    include: {
      products: true,
      collections: true,
    },
  } as never)) as CampaignRecord | null;
}

export async function listVisibleStorefrontCampaignsForShop(
  shop: string,
  now = new Date(),
): Promise<CampaignRecord[]> {
  return (await prisma.discountCampaign.findMany({
    where: {
      shop,
      status: "ACTIVE",
      syncStatus: "SYNCED",
      OR: [{ startsAt: null }, { startsAt: { lte: now } }],
      AND: [{ OR: [{ endsAt: null }, { endsAt: { gt: now } }] }],
    },
    include: {
      products: true,
      collections: true,
    },
    orderBy: {
      updatedAt: "desc",
    },
  } as never)) as CampaignRecord[];
}

export async function createCampaign({
  shop,
  title,
  discountKind,
  discountValue,
  badgeText,
  selectedProducts,
  selectedCollections,
  startsAt,
  endsAt,
}: {
  shop: string;
  title: string;
  discountKind: DiscountKind;
  discountValue: number;
  badgeText: string | null;
  selectedProducts: SelectedProductInput[];
  selectedCollections: SelectedCollectionInput[];
  startsAt?: Date | null;
  endsAt?: Date | null;
}) {
  return (await prisma.discountCampaign.create({
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
      collections: {
        create: selectedCollections.map((collection) => ({
          collectionGid: collection.collectionGid,
          collectionTitle: collection.collectionTitle ?? null,
          collectionHandle: collection.collectionHandle ?? null,
          imageUrl: collection.imageUrl ?? null,
        })),
      },
    },
    include: {
      products: true,
      collections: true,
    },
  } as never)) as CampaignRecord;
}

export async function updateCampaign({
  campaignId,
  shop,
  title,
  discountKind,
  discountValue,
  badgeText,
  selectedProducts,
  selectedCollections,
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
  selectedCollections: SelectedCollectionInput[];
  startsAt?: Date | null;
  endsAt?: Date | null;
}) {
  return (await prisma.discountCampaign.update({
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
      collections: {
        deleteMany: {},
        create: selectedCollections.map((collection) => ({
          collectionGid: collection.collectionGid,
          collectionTitle: collection.collectionTitle ?? null,
          collectionHandle: collection.collectionHandle ?? null,
          imageUrl: collection.imageUrl ?? null,
        })),
      },
    },
    include: {
      products: true,
      collections: true,
    },
  } as never)) as CampaignRecord;
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
