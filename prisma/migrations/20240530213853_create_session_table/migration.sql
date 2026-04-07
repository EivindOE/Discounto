-- CreateTable
CREATE TABLE "Session" (
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
CREATE TABLE "ShopSettings" (
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
CREATE TABLE "DiscountCampaign" (
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
CREATE TABLE "DiscountProduct" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "productGid" TEXT NOT NULL,
    "productTitle" TEXT,
    "productHandle" TEXT,
    "imageUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DiscountProduct_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "DiscountCampaign" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ShopSettings_shop_key" ON "ShopSettings"("shop");

-- CreateIndex
CREATE INDEX "DiscountCampaign_shop_status_idx" ON "DiscountCampaign"("shop", "status");

-- CreateIndex
CREATE INDEX "DiscountProduct_productGid_idx" ON "DiscountProduct"("productGid");

-- CreateIndex
CREATE UNIQUE INDEX "DiscountProduct_campaignId_productGid_key" ON "DiscountProduct"("campaignId", "productGid");
