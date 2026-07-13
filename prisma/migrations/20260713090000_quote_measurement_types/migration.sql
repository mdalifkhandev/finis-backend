CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS "quote_measurement_types" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "value" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "quote_measurement_types_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "quote_measurement_types_value_key" ON "quote_measurement_types"("value");
CREATE INDEX IF NOT EXISTS "quote_measurement_types_is_active_sort_order_idx" ON "quote_measurement_types"("is_active", "sort_order");

INSERT INTO "quote_measurement_types" ("value", "label", "sort_order", "is_active", "created_at", "updated_at")
VALUES
  ('sqft', 'Sq Ft', 0, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('linear_ft', 'Linear Ft', 1, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('each', 'Each', 2, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('room', 'Room', 3, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('hour', 'Hour', 4, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('lump_sum', 'Lump Sum', 5, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("value") DO NOTHING;
