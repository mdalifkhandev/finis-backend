/*
  Warnings:

  - You are about to drop the column `center_lat` on the `geofences` table. All the data in the column will be lost.
  - You are about to drop the column `center_lng` on the `geofences` table. All the data in the column will be lost.
  - You are about to drop the column `radius_meters` on the `geofences` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "geofences" DROP COLUMN "center_lat",
DROP COLUMN "center_lng",
DROP COLUMN "radius_meters";
