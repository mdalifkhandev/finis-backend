-- Add admin reimbursement expense storage without changing existing task expenses.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO $$ BEGIN
  CREATE TYPE "ReimbursementExpenseStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'PAID');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "reimbursement_expenses" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "title" TEXT NOT NULL,
  "expense_date" DATE NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'BDT',
  "category" TEXT NOT NULL,
  "vendor" TEXT,
  "payment_method" TEXT,
  "project_id" UUID,
  "notes" TEXT,
  "receipt_url" TEXT,
  "status" "ReimbursementExpenseStatus" NOT NULL DEFAULT 'DRAFT',
  "created_by_id" UUID NOT NULL,
  "submitted_at" TIMESTAMP(3),
  "approved_at" TIMESTAMP(3),
  "rejected_at" TIMESTAMP(3),
  "paid_at" TIMESTAMP(3),
  "rejection_note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "reimbursement_expenses_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "reimbursement_expenses_created_by_id_idx" ON "reimbursement_expenses"("created_by_id");
CREATE INDEX IF NOT EXISTS "reimbursement_expenses_project_id_idx" ON "reimbursement_expenses"("project_id");
CREATE INDEX IF NOT EXISTS "reimbursement_expenses_status_idx" ON "reimbursement_expenses"("status");
CREATE INDEX IF NOT EXISTS "reimbursement_expenses_expense_date_idx" ON "reimbursement_expenses"("expense_date");

DO $$ BEGIN
  ALTER TABLE "reimbursement_expenses"
    ADD CONSTRAINT "reimbursement_expenses_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "reimbursement_expenses"
    ADD CONSTRAINT "reimbursement_expenses_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
