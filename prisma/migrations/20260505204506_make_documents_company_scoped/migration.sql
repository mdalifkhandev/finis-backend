/*
  Warnings:

  - You are about to drop the column `project_id` on the `documents` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "documents" DROP CONSTRAINT "documents_project_id_fkey";

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "company_id" UUID;

-- Backfill company_id for existing documents before removing project_id
UPDATE "documents" d
SET "company_id" = p."company_id"
FROM "projects" p
WHERE d."project_id" = p."id";

ALTER TABLE "documents" DROP COLUMN "project_id";

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
