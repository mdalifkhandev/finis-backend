ALTER TABLE "reimbursement_expenses" ADD COLUMN "sub_task_id" UUID;

CREATE INDEX "reimbursement_expenses_sub_task_id_idx" ON "reimbursement_expenses"("sub_task_id");

ALTER TABLE "reimbursement_expenses"
  ADD CONSTRAINT "reimbursement_expenses_sub_task_id_fkey"
  FOREIGN KEY ("sub_task_id") REFERENCES "sub_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
