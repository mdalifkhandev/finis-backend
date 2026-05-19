-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "house_sections" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "is_whole_house" BOOLEAN NOT NULL DEFAULT false;

-- AddForeignKey
ALTER TABLE "inventory_usage_logs" ADD CONSTRAINT "inventory_usage_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
