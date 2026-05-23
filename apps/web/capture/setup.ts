// `./seed-env` must be imported before `@stagecraft/db`: it sets
// DATABASE_URL so the Prisma client (constructed at import time)
// connects to the right database. Keep this import first.
import "./seed-env";

import fs from "node:fs";
import path from "node:path";

import { prisma } from "@stagecraft/db";

import {
  CAPTURE_SESSION_TOKEN,
  CAPTURE_SITE_ID,
  CAPTURE_STORAGE_STATE,
  CAPTURE_USER_EMAIL,
} from "../playwright.capture.config";

/**
 * Global setup for the platform screenshot-capture config.
 *
 *   1. Seed the minimal rows for an authenticated, populated dashboard:
 *      a User, a Resend IntegrationAccount (without it /dashboard
 *      bounces to /onboarding), one "active" Site, and a Session whose
 *      token we control. All upserts, so re-runs are idempotent.
 *   2. Write a Playwright storage state carrying that session token as
 *      the `authjs.session-token` cookie, so every capture request
 *      arrives authenticated — no OAuth round-trip (see the config
 *      header for why a raw token works under the database session
 *      strategy).
 */
export default async function captureSetup(): Promise<void> {
  // 7-day session; the cookie value below matches this token verbatim.
  const expires = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);

  try {
    const user = await prisma.user.upsert({
      where: { email: CAPTURE_USER_EMAIL },
      update: { name: "Sarah Chen" },
      create: { email: CAPTURE_USER_EMAIL, name: "Sarah Chen" },
    });

    // /dashboard redirects to /onboarding until a Resend integration is
    // connected (dashboard/page.tsx) — seed one so the dashboard renders.
    await prisma.integrationAccount.upsert({
      where: { userId_provider: { userId: user.id, provider: "resend" } },
      update: { providerAccountId: CAPTURE_USER_EMAIL },
      create: {
        userId: user.id,
        provider: "resend",
        providerAccountId: CAPTURE_USER_EMAIL,
        scopes: "email",
      },
    });

    // An "active" site with a repo + production URL so the dashboard card
    // and the site-detail page render real content.
    const siteData = {
      userId: user.id,
      name: "Sarah Chen",
      slug: "sarah-chen-capture",
      status: "active",
      blueprintType: "solo-artist",
      githubRepoOwner: "stagecraft-demo",
      githubRepoName: "sarah-chen",
      githubInstallationId: 12_345_678,
      deployTarget: "netlify",
      netlifyAdminUrl: "https://app.netlify.com/sites/sarah-chen-demo",
      productionUrl: "https://sarah-chen.example.com",
    };
    await prisma.site.upsert({
      where: { id: CAPTURE_SITE_ID },
      update: siteData,
      create: { id: CAPTURE_SITE_ID, ...siteData },
    });

    await prisma.session.upsert({
      where: { sessionToken: CAPTURE_SESSION_TOKEN },
      update: { userId: user.id, expires },
      create: { sessionToken: CAPTURE_SESSION_TOKEN, userId: user.id, expires },
    });
  } catch (err) {
    throw new Error(
      "Capture seed could not reach the database. Make sure Postgres is up " +
        "and migrated — `docker compose up -d` then `npm run db:migrate` from " +
        `the repo root. Original error: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    await prisma.$disconnect();
  }

  const storageState = {
    cookies: [
      {
        name: "authjs.session-token",
        value: CAPTURE_SESSION_TOKEN,
        domain: "localhost",
        path: "/",
        expires: Math.floor(expires.getTime() / 1000),
        httpOnly: true,
        secure: false,
        sameSite: "Lax" as const,
      },
    ],
    origins: [],
  };
  fs.mkdirSync(path.dirname(CAPTURE_STORAGE_STATE), { recursive: true });
  fs.writeFileSync(CAPTURE_STORAGE_STATE, JSON.stringify(storageState, null, 2));
}
