ALTER TABLE "location_logs"
ADD COLUMN IF NOT EXISTS "duration_seconds" INTEGER;
