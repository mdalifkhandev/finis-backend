/*
  Warnings:

  - Added the required column `updated_at` to the `message_threads` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "message_threads" 
ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT NOW();

UPDATE "message_threads" 
SET "updated_at" = "created_at";