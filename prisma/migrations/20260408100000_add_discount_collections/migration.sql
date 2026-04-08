-- CreateTable
CREATE TABLE "DiscountCollection" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "collectionGid" TEXT NOT NULL,
    "collectionTitle" TEXT,
    "collectionHandle" TEXT,
    "imageUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscountCollection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DiscountCollection_collectionGid_idx" ON "DiscountCollection"("collectionGid");

-- CreateIndex
CREATE UNIQUE INDEX "DiscountCollection_campaignId_collectionGid_key" ON "DiscountCollection"("campaignId", "collectionGid");

-- AddForeignKey
ALTER TABLE "DiscountCollection" ADD CONSTRAINT "DiscountCollection_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "DiscountCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
