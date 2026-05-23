-- Add deploy-target fields so a Site can target either Netlify or Vercel.
-- Existing rows default to "netlify" so legacy sites continue to behave
-- exactly as before; new sites pick the target based on which integration
-- the artist has connected at /create time.

ALTER TABLE "Site"
  ADD COLUMN "deployTarget" TEXT NOT NULL DEFAULT 'netlify',
  ADD COLUMN "vercelProjectId" TEXT,
  ADD COLUMN "vercelProjectName" TEXT,
  ADD COLUMN "vercelTeamId" TEXT;
