-- AlterTable
ALTER TABLE "devices" ADD COLUMN "notificationChannel" TEXT DEFAULT 'email';
ALTER TABLE "devices" ADD COLUMN "notificationTarget" TEXT;
