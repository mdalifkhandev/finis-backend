-- Add optional internal price/value fields for admin-created task and subtask billing.
ALTER TABLE "tasks" ADD COLUMN "price" DOUBLE PRECISION;
ALTER TABLE "sub_tasks" ADD COLUMN "price" DOUBLE PRECISION;
