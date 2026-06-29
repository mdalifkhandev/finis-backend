-- AlterTable
ALTER TABLE "users" ADD COLUMN     "last_active_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "quotes" (
    "id" UUID NOT NULL,
    "created_by_id" UUID NOT NULL,
    "project_type" TEXT NOT NULL,
    "property_type" TEXT NOT NULL,
    "unit_type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "unit" TEXT,
    "unit_price" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "subtotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT,
    "is_custom" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "quotes_project_type_property_type_unit_type_idx" ON "quotes"("project_type", "property_type", "unit_type");

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
