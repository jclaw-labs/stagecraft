-- DropTable: AssetUpload (issue #410).
-- Contract step of expand/contract (docs/runbook.md §10). #407 removed the
-- asset upload API and AssetManager, the only code that read or wrote this
-- table. Runbook §10 allows the drop only once no deployed code reads or
-- writes the table, so the production platform (stagecraft.website, served
-- by Netlify, not the workers.dev preview) must be running #407 or later
-- before this applies. The migration-safety check flags any DROP TABLE, so
-- the PR carrying this needs the `migration:destructive-ok` label.

-- DropForeignKey
ALTER TABLE "AssetUpload" DROP CONSTRAINT "AssetUpload_siteId_fkey";

-- DropForeignKey
ALTER TABLE "AssetUpload" DROP CONSTRAINT "AssetUpload_userId_fkey";

-- DropTable
DROP TABLE "AssetUpload";
