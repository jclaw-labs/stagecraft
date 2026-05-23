import { z } from "zod";

import { prisma } from "@stagecraft/db";

import { auth } from "@/lib/auth";
import { generateBrokerSecret } from "@/lib/broker-secret";
import { listInstallationRepos } from "@/lib/github-app-install";
import { GitHubAppMisconfiguredError } from "@/lib/github-app-token";
import {
  setEnvVars as setNetlifyEnvVars,
  triggerBuild as triggerNetlifyBuild,
} from "@/lib/integrations/netlify";
import {
  setEnvVars as setVercelEnvVars,
  triggerDeployment as triggerVercelDeployment,
} from "@/lib/integrations/vercel";
import { verifyInstallState } from "@/lib/state-signing";

const searchSchema = z.object({
  installation_id: z.coerce.number().int().positive(),
  state: z.string().min(1),
  setup_action: z.string().optional(),
});

function htmlResponse(status: number, body: string) {
  return new Response(`<!DOCTYPE html>\n${body}`, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );
}

function page(title: string, content: string): string {
  // Token definitions mirror apps/web/src/app/globals.css. Inlined here
  // because this route returns raw HTML (not a Next.js page), so the
  // layout's globals.css import doesn't apply. Consumer rules below use
  // var(--*) only — no raw hex / px. Per CLAUDE.md §7.
  return `<html><head><title>${escape(title)}</title><meta name="viewport" content="width=device-width, initial-scale=1"><style>
:root {
  --color-text: #111827;
  --color-surface: #ffffff;
  --color-surface-raised: #f3f4f6;
  --color-success: #15803d;
  --color-warning: #92400e;
  --color-error: #cc0000;
  --font-body: system-ui, -apple-system, sans-serif;
  --font-size-sm: 0.875rem;
  --font-size-base: 1rem;
  --font-size-2xl: 1.5rem;
  --line-height-base: 1.6;
  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-4: 1rem;
  --space-12: 3rem;
  --max-width-narrow: 40rem;
  --radius-sm: 0.25rem;
  --radius: 0.375rem;
}
body { font: var(--font-size-base)/var(--line-height-base) var(--font-body); max-width: var(--max-width-narrow); margin: var(--space-12) auto; padding: 0 var(--space-4); color: var(--color-text); }
h1 { font-size: var(--font-size-2xl); }
code { background: var(--color-surface-raised); padding: var(--space-1) var(--space-1); border-radius: var(--radius-sm); font-size: var(--font-size-sm); }
pre { background: var(--color-surface-raised); padding: var(--space-4); border-radius: var(--radius); overflow-x: auto; font-size: var(--font-size-sm); }
.error { color: var(--color-error); }
.ok { color: var(--color-success); }
.warn { color: var(--color-warning); }
a.button { display: inline-block; padding: var(--space-2) var(--space-4); background: var(--color-text); color: var(--color-surface); text-decoration: none; border-radius: var(--radius); margin-top: var(--space-4); }
</style></head><body>${content}</body></html>`;
}

function errorPage(status: number, title: string, message: string) {
  return htmlResponse(
    status,
    page(
      title,
      `<h1 class="error">${escape(title)}</h1><p>${escape(message)}</p><p><a href="/dashboard">Back to dashboard</a></p>`,
    ),
  );
}

/**
 * Push the broker secret + companion env vars to the artist's deploy
 * target and kick off a fresh build so the next request picks them up.
 *
 * Returns `{ ok: true }` on success or `{ ok: false, reason }` when the
 * site doesn't have a deploy target wired up (older sites pre-#90) or
 * when the upstream API call fails. The caller falls back to showing
 * the manual-setup instructions in either case.
 */
async function provisionBrokerSecret(args: {
  userId: string;
  site: {
    id: string;
    deployTarget: string;
    netlifySiteId: string | null;
    vercelProjectId: string | null;
    vercelTeamId: string | null;
  };
  brokerSecret: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  // STAGECRAFT_PLATFORM_URL is intentionally NOT provisioned here —
  // the artist template's publish.ts defaults to the prod URL, so
  // there's no per-site value to write.
  const envVars: Record<string, string> = {
    STAGECRAFT_SITE_ID: args.site.id,
    STAGECRAFT_BROKER_SECRET: args.brokerSecret,
  };

  try {
    if (args.site.deployTarget === "vercel") {
      if (!args.site.vercelProjectId) {
        return { ok: false, reason: "Site has no Vercel project id on file" };
      }
      await setVercelEnvVars({
        userId: args.userId,
        projectId: args.site.vercelProjectId,
        teamId: args.site.vercelTeamId ?? undefined,
        vars: envVars,
      });
      await triggerVercelDeployment(
        args.userId,
        args.site.vercelProjectId,
        args.site.vercelTeamId ?? undefined,
      );
      return { ok: true };
    }

    if (args.site.deployTarget === "netlify") {
      if (!args.site.netlifySiteId) {
        return { ok: false, reason: "Site has no Netlify site id on file" };
      }
      await setNetlifyEnvVars(args.userId, args.site.netlifySiteId, envVars);
      await triggerNetlifyBuild(args.userId, args.site.netlifySiteId);
      return { ok: true };
    }

    return {
      ok: false,
      reason: `Unknown deploy target: ${args.site.deployTarget}`,
    };
  } catch (cause) {
    return {
      ok: false,
      reason: cause instanceof Error ? cause.message : String(cause),
    };
  }
}

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return errorPage(401, "Sign in required", "Please sign in to the platform first, then re-run the install.");
  }

  const url = new URL(request.url);
  const params = searchSchema.safeParse({
    installation_id: url.searchParams.get("installation_id"),
    state: url.searchParams.get("state"),
    setup_action: url.searchParams.get("setup_action") ?? undefined,
  });
  if (!params.success) {
    return errorPage(400, "Missing parameters", "The install callback URL is missing required parameters. Restart the install from your dashboard.");
  }

  const stateData = await verifyInstallState(params.data.state);
  if (!stateData) {
    return errorPage(400, "Install link expired or invalid", "Your install link is older than 10 minutes or was tampered with. Restart from your dashboard.");
  }
  if (stateData.userId !== session.user.id) {
    return errorPage(403, "User mismatch", "This install was initiated by a different user. Restart from your own dashboard.");
  }

  const site = await prisma.site.findUnique({ where: { id: stateData.siteId } });
  if (!site || site.userId !== session.user.id) {
    return errorPage(404, "Site not found", "We couldn't find that site under your account. Restart from your dashboard.");
  }

  if (site.brokerSecretHash) {
    return htmlResponse(
      200,
      page(
        "Already connected",
        `<h1 class="warn">Already connected</h1>
<p>Site <code>${escape(site.name)}</code> already has the GitHub App installed and a broker secret provisioned. Refreshing this page does not regenerate the secret.</p>
<p>If you've lost your broker secret, you'll need to <strong>rotate</strong> it from the dashboard (this updates the hash on the platform; you then update the env var on your deployed site).</p>
<p><a class="button" href="/dashboard">Back to dashboard</a></p>`,
      ),
    );
  }

  let repos;
  try {
    repos = await listInstallationRepos(params.data.installation_id);
  } catch (cause) {
    if (cause instanceof GitHubAppMisconfiguredError) {
      return errorPage(500, "GitHub App not configured", "The platform is missing GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY. Contact support.");
    }
    return errorPage(500, "Could not reach GitHub", `Listing installation repositories failed: ${escape(String(cause))}`);
  }

  if (repos.length === 0) {
    return errorPage(
      400,
      "No repositories selected",
      "Add at least one repository to the install on GitHub.",
    );
  }

  // GitHub Apps install per account, not per repo — one artist with
  // multiple Stagecraft sites has one installation whose repo list grows
  // as they grant more repos. Find the specific repo this Site already
  // owns (set by /create's createRepo step) inside the installation's
  // list; don't reject just because the install spans many repos.
  let owner: string;
  let name: string;
  if (site.githubRepoOwner && site.githubRepoName) {
    const target = `${site.githubRepoOwner}/${site.githubRepoName}`;
    const matched = repos.find(
      (r) => r.owner === site.githubRepoOwner && r.name === site.githubRepoName,
    );
    if (!matched) {
      return errorPage(
        400,
        "Repo not in install",
        `This site needs the App on ${target}, but the installation grants access to ${repos.length} other ${repos.length === 1 ? "repository" : "repositories"}. Edit the install on GitHub to include ${target}.`,
      );
    }
    owner = matched.owner;
    name = matched.name;
  } else {
    // Fallback for sites that haven't been through /create's repo-creation
    // step (currently every Site goes through it, but the schema allows
    // these fields to be null). Single-repo installs only.
    if (repos.length > 1) {
      return errorPage(
        400,
        "Multiple repositories selected",
        `The install grants access to ${repos.length} repositories, but this site has no repo on file yet. Edit the install on GitHub to select exactly one.`,
      );
    }
    owner = repos[0].owner;
    name = repos[0].name;
  }

  const { plaintext, hash } = generateBrokerSecret();

  await prisma.site.update({
    where: { id: site.id },
    data: {
      githubInstallationId: params.data.installation_id,
      githubRepoOwner: owner,
      githubRepoName: name,
      brokerSecretHash: hash,
      githubAppSuspended: false,
    },
  });

  const provisioned = await provisionBrokerSecret({
    userId: session.user.id,
    site: {
      id: site.id,
      deployTarget: site.deployTarget,
      netlifySiteId: site.netlifySiteId,
      vercelProjectId: site.vercelProjectId,
      vercelTeamId: site.vercelTeamId,
    },
    brokerSecret: plaintext,
  });

  if (provisioned.ok) {
    return htmlResponse(
      200,
      page(
        "GitHub App connected",
        `<h1 class="ok">Connected — your site is rebuilding</h1>
<p>Site <code>${escape(site.name)}</code> is now linked to <code>${escape(owner)}/${escape(name)}</code>. We pushed the broker secret to your <strong>${escape(site.deployTarget)}</strong> deploy and triggered a fresh build — it will pick up the new env vars and start serving updates from the editor in a minute or two.</p>
<p><a class="button" href="/dashboard">Continue to dashboard</a></p>`,
      ),
    );
  }

  // Auto-provision failed — fall back to showing the manual env-var
  // block. Keep the broker secret on screen so the artist can recover
  // without rotating; rotation invalidates the hash we just stored.
  return htmlResponse(
    200,
    page(
      "GitHub App connected — manual setup needed",
      `<h1 class="warn">Connected — finish setup manually</h1>
<p>Site <code>${escape(site.name)}</code> is linked to <code>${escape(owner)}/${escape(name)}</code>, but we couldn't push the broker secret to your <strong>${escape(site.deployTarget)}</strong> deploy automatically. Reason: <code>${escape(provisioned.reason)}</code>.</p>

<h2>Set these env vars on your deployed site, then redeploy</h2>
<pre>STAGECRAFT_SITE_ID=${escape(site.id)}
STAGECRAFT_BROKER_SECRET=${escape(plaintext)}</pre>

<p><strong>Copy the secret now</strong> — it is shown exactly once and never stored on the platform in plaintext. If you lose it, rotate it from the dashboard; the previous one will stop working.</p>
<p><a class="button" href="/dashboard">Continue to dashboard</a></p>`,
    ),
  );
}
