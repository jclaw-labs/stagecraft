-- AlterTable: give Site.blueprintType a default (issue #445).
-- Expand step of expand/contract (docs/runbook.md §10). The column is
-- required, always "solo-artist", and nothing reads it. This release stops
-- the app writing it, so inserts from the new code rely on this default;
-- code built before it still writes "solo-artist" explicitly, which keeps
-- working. Dropping the column is the contract step, in its own PR once
-- this is deployed.
ALTER TABLE "Site" ALTER COLUMN "blueprintType" SET DEFAULT 'solo-artist';
