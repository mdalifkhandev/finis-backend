-- Clean up the previously removed category experiment if it exists.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
DROP INDEX IF EXISTS "quotes_category_id_idx";
ALTER TABLE "quotes" DROP CONSTRAINT IF EXISTS "quotes_category_id_fkey";
ALTER TABLE "quotes" DROP COLUMN IF EXISTS "category_id";
DROP TABLE IF EXISTS "quote_categories" CASCADE;

-- Master category table used by the quotation work-item library.
CREATE TABLE IF NOT EXISTS "quote_work_categories" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "name" TEXT NOT NULL,
  "description" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "quote_work_categories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "quote_work_categories_name_key" ON "quote_work_categories"("name");
CREATE INDEX IF NOT EXISTS "quote_work_categories_is_active_sort_order_idx" ON "quote_work_categories"("is_active", "sort_order");

-- Master work-item table. One row represents one searchable quotation item.
CREATE TABLE IF NOT EXISTS "quote_work_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "category_id" UUID NOT NULL,
  "project_type" TEXT NOT NULL,
  "property_type" TEXT NOT NULL,
  "unit_type" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "measurement_type" TEXT NOT NULL,
  "unit_cost" DOUBLE PRECISION,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "quote_work_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "quote_work_items_category_id_project_type_property_type_unit_type_name_key"
  ON "quote_work_items"("category_id", "project_type", "property_type", "unit_type", "name");
CREATE INDEX IF NOT EXISTS "quote_work_items_category_id_is_active_sort_order_idx"
  ON "quote_work_items"("category_id", "is_active", "sort_order");
CREATE INDEX IF NOT EXISTS "quote_work_items_project_type_property_type_unit_type_is_active_idx"
  ON "quote_work_items"("project_type", "property_type", "unit_type", "is_active");

-- Quote rows now keep a snapshot of the selected work item and category.
ALTER TABLE "quotes" ADD COLUMN IF NOT EXISTS "work_item_id" UUID;
ALTER TABLE "quotes" ADD COLUMN IF NOT EXISTS "work_category_id" UUID;
ALTER TABLE "quotes" ADD COLUMN IF NOT EXISTS "measurement_type" TEXT;

CREATE INDEX IF NOT EXISTS "quotes_work_category_id_idx" ON "quotes"("work_category_id");
CREATE INDEX IF NOT EXISTS "quotes_work_item_id_idx" ON "quotes"("work_item_id");

ALTER TABLE "quote_work_items"
  ADD CONSTRAINT "quote_work_items_category_id_fkey"
  FOREIGN KEY ("category_id") REFERENCES "quote_work_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "quotes"
  ADD CONSTRAINT "quotes_work_item_id_fkey"
  FOREIGN KEY ("work_item_id") REFERENCES "quote_work_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "quotes"
  ADD CONSTRAINT "quotes_work_category_id_fkey"
  FOREIGN KEY ("work_category_id") REFERENCES "quote_work_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
