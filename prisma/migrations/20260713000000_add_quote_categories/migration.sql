-- CreateTable
CREATE TABLE "quote_categories" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quote_categories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "quote_categories_name_key" ON "quote_categories"("name");

-- CreateIndex
CREATE INDEX "quote_categories_is_active_sort_order_idx" ON "quote_categories"("is_active", "sort_order");

-- AlterTable
ALTER TABLE "quotes" ADD COLUMN "category_id" UUID;

-- CreateIndex
CREATE INDEX "quotes_category_id_idx" ON "quotes"("category_id");

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "quote_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
