import { createPrivateKey } from "node:crypto";

import { createAppAuth } from "@octokit/auth-app";

export type InstallationToken = {
  token: string;
  expiresAt: string;
};

export class GitHubAppMisconfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitHubAppMisconfiguredError";
  }
}

/**
 * Normalize whatever PEM is in `GITHUB_APP_PRIVATE_KEY` into PKCS#8.
 *
 * Handles three real-world env-var shapes:
 *
 * 1. Multi-line PEM with real newlines (the `.pem` you download from GitHub).
 * 2. Single-line PEM where newlines are escaped as literal `\n` (some
 *    deployment dashboards do this).
 * 3. Single-line PEM where newlines have been replaced with single spaces
 *    (Netlify dashboard fields and `netlify env:set` both flatten this way —
 *    confirmed in production smoke testing). The header / footer still have
 *    `-----BEGIN ... PRIVATE KEY-----` markers; we extract those, strip all
 *    whitespace from the body, and re-emit canonical 64-char-line form.
 *
 * After format reconstruction, round-trip through `createPrivateKey` to
 * accept either PKCS#1 (`-----BEGIN RSA PRIVATE KEY-----`) or PKCS#8
 * (`-----BEGIN PRIVATE KEY-----`) and always emit PKCS#8 — required by
 * `@octokit/auth-app` v8+'s Web Crypto path.
 */
export function normalizePrivateKey(raw: string): string {
  let pem = raw;

  // macOS `security find-generic-password -w` returns multi-line
  // passwords as hex-encoded strings (since newlines can't display
  // cleanly in single-line output). Detect and decode.
  if (/^[0-9a-fA-F]+$/.test(pem) && pem.length % 2 === 0 && pem.startsWith("2d2d2d2d2d")) {
    pem = Buffer.from(pem, "hex").toString("utf8");
  }

  pem = pem.replace(/\\n/g, "\n");

  if (!pem.includes("\n")) {
    const begin = pem.match(/-----BEGIN [A-Z0-9 ]+ KEY-----/);
    const end = pem.match(/-----END [A-Z0-9 ]+ KEY-----/);
    if (begin && end && begin.index !== undefined && end.index !== undefined) {
      const body = pem
        .slice(begin.index + begin[0].length, end.index)
        .replace(/\s+/g, "");
      const lines: string[] = [];
      for (let i = 0; i < body.length; i += 64) {
        lines.push(body.slice(i, i + 64));
      }
      pem = `${begin[0]}\n${lines.join("\n")}\n${end[0]}\n`;
    }
  }

  const keyObject = createPrivateKey(pem);
  return keyObject.export({ type: "pkcs8", format: "pem" }) as string;
}

function getAppCredentials(): { appId: string; privateKey: string } {
  const appId = process.env.GITHUB_APP_ID;
  const privateKeyRaw = process.env.GITHUB_APP_PRIVATE_KEY;
  if (!appId || !privateKeyRaw) {
    throw new GitHubAppMisconfiguredError("GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY not set");
  }
  return { appId, privateKey: normalizePrivateKey(privateKeyRaw) };
}

/**
 * Mint a GitHub installation access token for the given installation id.
 * Returns the token + ISO expiry. Throws GitHubAppMisconfiguredError when
 * GITHUB_APP_ID or GITHUB_APP_PRIVATE_KEY are unset.
 */
export async function mintInstallationToken(
  installationId: number,
): Promise<InstallationToken> {
  const { appId, privateKey } = getAppCredentials();
  const auth = createAppAuth({ appId, privateKey, installationId });
  const result = await auth({ type: "installation" });

  return {
    token: result.token,
    expiresAt: result.expiresAt,
  };
}

/**
 * Find an existing installation of this GitHub App on a given account
 * using App-level JWT auth (not the user's OAuth token). Returns the
 * installation id or null if not installed on that account.
 */
export async function findAppInstallationForOwner(
  ownerLogin: string,
): Promise<number | null> {
  const { appId, privateKey } = getAppCredentials();
  const auth = createAppAuth({ appId, privateKey });
  const { token } = await auth({ type: "app" });

  const res = await fetch(
    `https://api.github.com/users/${encodeURIComponent(ownerLogin)}/installation`,
    { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } },
  );
  if (!res.ok) return null;
  const data = (await res.json()) as { id: number };
  return data.id;
}
