-- Bootstrap schema for local development when Prisma migrate is unavailable.
-- This matches the current Prisma schema for Discounto.

-- CreateTable
CREATE TABLE IF NOT EXISTS "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" DATETIME,
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" DATETIME
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ShopSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'FREE',
    "productLimit" INTEGER NOT NULL DEFAULT 10,
    "billingStatus" TEXT NOT NULL DEFAULT 'inactive',
    "activeChargeId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "DiscountCampaign" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "syncStatus" TEXT NOT NULL DEFAULT 'DRAFT',
    "discountKind" TEXT NOT NULL,
    "discountValue" REAL NOT NULL,
    "currencyCode" TEXT NOT NULL DEFAULT 'USD',
    "badgeText" TEXT,
    "shopifyDiscountId" TEXT,
    "lastSyncError" TEXT,
    "startsAt" DATETIME,
    "endsAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DiscountCampaign_shop_fkey" FOREIGN KEY ("shop") REFERENCES "ShopSettings" ("shop") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "DiscountProduct" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "productGid" TEXT NOT NULL,
    "productTitle" TEXT,
    "productHandle" TEXT,
    "imageUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DiscountProduct_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "DiscountCampaign" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "DiscountCollection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "collectionGid" TEXT NOT NULL,
    "collectionTitle" TEXT,
    "collectionHandle" TEXT,
    "imageUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DiscountCollection_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "DiscountCampaign" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ShopSettings_shop_key" ON "ShopSettings"("shop");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DiscountCampaign_shop_status_idx" ON "DiscountCampaign"("shop", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DiscountProduct_productGid_idx" ON "DiscountProduct"("productGid");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "DiscountProduct_campaignId_productGid_key" ON "DiscountProduct"("campaignId", "productGid");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DiscountCollection_collectionGid_idx" ON "DiscountCollection"("collectionGid");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "DiscountCollection_campaignId_collectionGid_key" ON "DiscountCollection"("campaignId", "collectionGid");
