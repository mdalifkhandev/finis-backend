/*
  Warnings:

  - You are about to drop the column `company_id` on the `inventory_items` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "inventory_items" DROP CONSTRAINT "inventory_items_company_id_fkey";

-- AlterTable
ALTER TABLE "inventory_items" DROP COLUMN "company_id";
