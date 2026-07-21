-- AlterTable
ALTER TABLE "TeamMember" ADD COLUMN "sortBy" TEXT NOT NULL DEFAULT 'newest';
ALTER TABLE "TeamMember" ADD COLUMN "sortReversed" BOOLEAN NOT NULL DEFAULT false;
