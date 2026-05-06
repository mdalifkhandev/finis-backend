-- AlterTable
ALTER TABLE "payrolls" ADD COLUMN     "project_id" UUID;

-- AddForeignKey
ALTER TABLE "payrolls" ADD CONSTRAINT "payrolls_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
