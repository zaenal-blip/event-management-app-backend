/*
  Warnings:

  - You are about to drop the column `referallCode` on the `users` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "users" DROP COLUMN "referallCode",
ADD COLUMN     "referralCode" TEXT;
