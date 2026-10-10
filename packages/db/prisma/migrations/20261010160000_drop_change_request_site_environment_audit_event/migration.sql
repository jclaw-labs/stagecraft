-- Drops the tables of the cut AI-edit / change-request roadmap (#344, #399).
-- Neither the code before this change nor after it reads or writes them, so
-- both run on either side of this migration. The migration safety check flags
-- the DROPs, so the PR that adds this needs the migration:destructive-ok label.

-- DropForeignKey
ALTER TABLE "SiteEnvironment" DROP CONSTRAINT "SiteEnvironment_siteId_fkey";

-- DropForeignKey
ALTER TABLE "ChangeRequest" DROP CONSTRAINT "ChangeRequest_siteId_fkey";

-- DropForeignKey
ALTER TABLE "ChangeRequest" DROP CONSTRAINT "ChangeRequest_userId_fkey";

-- DropForeignKey
ALTER TABLE "ChangeRequest" DROP CONSTRAINT "ChangeRequest_jobId_fkey";

-- DropForeignKey
ALTER TABLE "AuditEvent" DROP CONSTRAINT "AuditEvent_userId_fkey";

-- DropForeignKey
ALTER TABLE "AuditEvent" DROP CONSTRAINT "AuditEvent_siteId_fkey";

-- DropTable
DROP TABLE "SiteEnvironment";

-- DropTable
DROP TABLE "ChangeRequest";

-- DropTable
DROP TABLE "AuditEvent";

