-- AlterTable
ALTER TABLE "subscription_plans" ADD COLUMN     "stripe_price_monthly_id" TEXT,
ADD COLUMN     "stripe_price_yearly_id" TEXT,
ADD COLUMN     "stripe_product_id" TEXT;
