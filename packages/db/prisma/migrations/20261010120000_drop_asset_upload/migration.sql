-- DropTable: AssetUpload (issue #410).
-- Contract step of expand/contract (docs/runbook.md §10). #407 removed the
-- asset upload API and AssetManager, the only code that read or wrote this
-- table, and is already deployed; no deployed code references the table, so
-- the code running during this deploy keeps working after the drop. The
-- migration-safety check flags any DROP TABLE, so the PR carrying this needs
-- the `migration:destructive-ok` label.

-- DropForeignKey
ALTER TABLE "AssetUpload" DROP CONSTRAINT "AssetUpload_siteId_fkey";

-- DropForeignKey
ALTER TABLE "AssetUpload" DROP CONSTRAINT "AssetUpload_userId_fkey";

-- DropTable
DROP TABLE "AssetUpload";
