-- AlterTable
ALTER TABLE "users" ADD COLUMN     "otp" TEXT,
ADD COLUMN     "otp_expires_at" TIMESTAMP(3),
ADD COLUMN     "reset_expires_at" TIMESTAMP(3),
ADD COLUMN     "reset_token" TEXT;
