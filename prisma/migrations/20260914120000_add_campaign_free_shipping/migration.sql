-- CreateEnum
CREATE TYPE "CampaignOffer" AS ENUM ('DISCOUNT', 'FREE_SHIPPING', 'DISCOUNT_AND_FREE_SHIPPING');

-- CreateEnum
CREATE TYPE "CampaignBadgeLayout" AS ENUM ('SEPARATE', 'COMBINED', 'DISCOUNT_ONLY');

-- AlterTable
ALTER TABLE "DiscountCampaign" ADD COLUMN     "badgeLayout" "CampaignBadgeLayout" NOT NULL DEFAULT 'SEPARATE',
ADD COLUMN     "freeShippingBadgeText" TEXT,
ADD COLUMN     "offerType" "CampaignOffer" NOT NULL DEFAULT 'DISCOUNT',
ADD COLUMN     "shopifyShippingDiscountId" TEXT,
ALTER COLUMN "discountKind" DROP NOT NULL,
ALTER COLUMN "discountValue" DROP NOT NULL;
