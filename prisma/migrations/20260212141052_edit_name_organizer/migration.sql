/*
  Warnings:

  - You are about to drop the column `referralRewardAmount` on the `organizers` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "organizers" DROP COLUMN "referralRewardAmount",
ALTER COLUMN "name" DROP NOT NULL;
