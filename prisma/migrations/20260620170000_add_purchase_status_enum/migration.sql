-- CreateEnum
CREATE TYPE "PurchaseStatus" AS ENUM ('active', 'canceled', 'expired', 'switched');

-- AlterTable
ALTER TABLE "subscription_purchases" ADD COLUMN "canceled_at" TIMESTAMP(3);

ALTER TABLE "subscription_purchases" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "subscription_purchases" ALTER COLUMN "status" TYPE "PurchaseStatus" USING ("status"::text::"PurchaseStatus");
ALTER TABLE "subscription_purchases" ALTER COLUMN "status" SET DEFAULT 'active';
