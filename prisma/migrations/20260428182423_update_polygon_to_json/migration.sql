/*
  Warnings:

  - The `polygon_coords` column on the `geofences` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "geofences" DROP COLUMN "polygon_coords",
ADD COLUMN     "polygon_coords" JSONB;
