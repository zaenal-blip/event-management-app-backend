-- AlterTable
ALTER TABLE "organizers" ADD COLUMN     "contactInfo" TEXT,
ADD COLUMN     "defaultMinPurchase" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "defaultVoucherValidityDays" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "notificationEmail" TEXT,
ADD COLUMN     "publicProfileVisible" BOOLEAN NOT NULL DEFAULT true;
