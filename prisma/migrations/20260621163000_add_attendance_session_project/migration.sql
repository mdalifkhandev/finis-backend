-- Add project relation to attendance sessions without touching existing data
ALTER TABLE "attendance_sessions"
ADD COLUMN "project_id" UUID;

ALTER TABLE "attendance_sessions"
ADD CONSTRAINT "attendance_sessions_project_id_fkey"
FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
