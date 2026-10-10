-- AlterTable: give Site.blueprintType a default (issue #445).
-- Expand step of expand/contract (docs/runbook.md §10). The column is
-- required, always "solo-artist", and nothing reads it. App code no longer
-- sets it, but the Prisma client still sends the schema's
-- @default("solo-artist") in every INSERT, so no insert relies on this
-- default yet. It exists for the next step: marking the field @ignore, after
-- which the client leaves the column out and this default fills it. Dropping
-- the column comes after that, in its own PR.
ALTER TABLE "Site" ALTER COLUMN "blueprintType" SET DEFAULT 'solo-artist';
