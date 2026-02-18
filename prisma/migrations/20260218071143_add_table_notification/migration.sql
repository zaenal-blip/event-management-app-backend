/*
  Warnings:

  - A unique constraint covering the columns `[qrToken]` on the table `attendees` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `qrToken` to the `attendees` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'TRANSACTION_ACCEPTED';
ALTER TYPE "NotificationType" ADD VALUE 'TRANSACTION_REJECTED';
ALTER TYPE "NotificationType" ADD VALUE 'NEW_PURCHASE';
ALTER TYPE "NotificationType" ADD VALUE 'WAITING_APPROVAL';
ALTER TYPE "NotificationType" ADD VALUE 'EVENT_SOLD_OUT';
ALTER TYPE "NotificationType" ADD VALUE 'POINTS_EXPIRING';

-- DropIndex
DROP INDEX "attendees_transactionId_userId_key";

-- AlterTable
ALTER TABLE "attendees" ADD COLUMN     "qrToken" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "relatedUrl" TEXT;

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "rejectionReason" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "attendees_qrToken_key" ON "attendees"("qrToken");
