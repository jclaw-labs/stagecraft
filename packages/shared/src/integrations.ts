/** Helpers for reading `IntegrationAccount` rows, whose `provider` column Prisma types as `string`. */

import { isIntegrationProvider, type IntegrationProvider } from "./types";

/**
 * The set of providers the given integration rows connect. Rows whose
 * `provider` is not a known IntegrationProvider are ignored.
 */
export function connectedProviders(
  accounts: readonly { provider: string }[],
): Set<IntegrationProvider> {
  const connected = new Set<IntegrationProvider>();
  for (const { provider } of accounts) {
    if (isIntegrationProvider(provider)) connected.add(provider);
  }
  return connected;
}

/** The first integration row for `provider`, or undefined if none is connected. */
export function findIntegration<T extends { provider: string }>(
  accounts: readonly T[],
  provider: IntegrationProvider,
): T | undefined {
  return accounts.find((account) => account.provider === provider);
}

/** What the artist is doing when a site gets provisioned, as it reads in messages. */
export type SiteSetupAction = "creating" | "migrating";

/**
 * Why the artist can't set up a site yet, or null when they can. Creating
 * and migrating a site provision it the same way, so both need GitHub (the
 * site's repo), a deploy target (Vercel or Netlify; the job prefers Vercel
 * when both are connected) and Resend (magic-link sign-in on the site).
 */
export function siteSetupIntegrationError(
  connected: ReadonlySet<IntegrationProvider>,
  action: SiteSetupAction,
): string | null {
  if (!connected.has("github")) {
    return `GitHub must be connected before ${action} a site`;
  }
  if (!connected.has("vercel") && !connected.has("netlify")) {
    return `A deploy target must be connected (Vercel or Netlify) before ${action} a site`;
  }
  if (!connected.has("resend")) {
    return `Resend must be connected (for magic-link sign-in on artist sites) before ${action} a site`;
  }
  return null;
}

/**
 * Netlify build settings for an artist site built from the musician-site
 * template. The template is Next.js (ADR-007) and ships no netlify.toml, so
 * the publish dir is Next's `.next`. Both the repo-linked and the bare-site
 * createSite calls use this, so the two can't drift apart again.
 */
export const MUSICIAN_SITE_NETLIFY_BUILD = { cmd: "npm run build", dir: ".next" } as const;
