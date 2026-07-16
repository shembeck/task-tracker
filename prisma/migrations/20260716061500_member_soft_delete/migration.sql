-- Soft-delete team members while keeping their tasks.
ALTER TABLE "TeamMember" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;
