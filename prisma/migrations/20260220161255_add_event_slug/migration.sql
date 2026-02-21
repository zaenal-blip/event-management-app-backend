/*
  Warnings:

  - A unique constraint covering the columns `[slug]` on the table `events` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `slug` to the `events` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable: Add column as nullable first
ALTER TABLE "events" ADD COLUMN "slug" TEXT;

-- Backfill: Generate slugs from existing titles
UPDATE "events" SET "slug" = LOWER(REGEXP_REPLACE(REGEXP_REPLACE(TRIM(title), '[^a-zA-Z0-9\s-]', '', 'g'), '\s+', '-', 'g')) || '-' || id;

-- Make column NOT NULL
ALTER TABLE "events" ALTER COLUMN "slug" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "events_slug_key" ON "events"("slug");
