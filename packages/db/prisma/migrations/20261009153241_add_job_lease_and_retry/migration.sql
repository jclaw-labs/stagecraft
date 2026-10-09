-- AlterTable: job lease + retry bookkeeping for SiteJob (issue #358).
-- All additive: nullable or defaulted, so workers built before this
-- migration keep running against the new schema (they ignore the columns).
ALTER TABLE "SiteJob" ADD COLUMN "lockedUntil"   TIMESTAMP(3),
                      ADD COLUMN "retryAttempts" INTEGER NOT NULL DEFAULT 0,
                      ADD COLUMN "runAt"         TIMESTAMP(3);
