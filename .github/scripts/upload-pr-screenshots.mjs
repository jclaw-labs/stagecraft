#!/usr/bin/env node
/**
 * upload-pr-screenshots.mjs
 *
 * Run by .github/workflows/pr-screenshots.yml on PR open / synchronize.
 *
 * Cloud Claude Code sessions can take screenshots locally (Playwright is
 * available) and commit them, but they can't `gh gist create` — there's no
 * `gh` CLI in the session, the GitHub MCP doesn't expose gist endpoints, and
 * the MCP is restricted to this repo. So sessions commit captures to
 * `.pr-screenshots/`; this script picks them up and:
 *
 *   1. Pushes them to a public gist (created on first run, reused after via
 *      a `<!-- screenshot-gist: ID -->` marker in the PR body).
 *   2. Replaces `<!-- screenshot:NAME -->` placeholders in the PR body with
 *      rendered image markdown. Files without a matching placeholder are
 *      appended under a `## Screenshots` section.
 *   3. Commits a `[skip ci]` cleanup that drops `.pr-screenshots/` from the
 *      branch so binary blobs don't pile up and the workflow doesn't loop.
 *
 * Required env: GH_TOKEN (auto), GIST_TOKEN (PAT with `gist` scope, set as
 * a repo secret), PR_NUMBER, PR_HEAD_REF.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SCREENSHOTS_DIR = ".pr-screenshots";
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg"]);
const MARKER_RE = /<!--\s*screenshot-gist:\s*([a-f0-9]{20,})\s*-->/i;
const BOT_NAME = "stagecraft-bot";
const BOT_EMAIL = "stagecraft-bot@users.noreply.github.com";

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    ...opts,
  }).trim();
}

function runWith(env, cmd, args, opts = {}) {
  return run(cmd, args, { ...opts, env: { ...process.env, ...env } });
}

function listScreenshots() {
  if (!fs.existsSync(SCREENSHOTS_DIR)) return [];
  return fs
    .readdirSync(SCREENSHOTS_DIR, { withFileTypes: true })
    .filter((e) => e.isFile() && IMAGE_EXTS.has(path.extname(e.name).toLowerCase()))
    .map((e) => path.join(SCREENSHOTS_DIR, e.name))
    .sort();
}

function getPrBody(prNumber) {
  const json = run("gh", ["pr", "view", prNumber, "--json", "body"]);
  return JSON.parse(json).body || "";
}

function setPrBody(prNumber, body) {
  execFileSync("gh", ["pr", "edit", prNumber, "--body-file", "-"], {
    input: body,
    stdio: ["pipe", "inherit", "inherit"],
  });
}

function gistUserLogin() {
  const json = runWith({ GH_TOKEN: process.env.GIST_TOKEN }, "gh", ["api", "user"]);
  return JSON.parse(json).login;
}

function createGist(prNumber) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pr-gist-init-"));
  const readme = path.join(tmp, "README.md");
  fs.writeFileSync(
    readme,
    `# stagecraft PR #${prNumber} screenshots\n\n` +
      `Auto-uploaded by .github/workflows/pr-screenshots.yml.\n` +
      `Update or delete by re-running the workflow on PR #${prNumber}.\n`
  );
  const out = runWith(
    { GH_TOKEN: process.env.GIST_TOKEN },
    "gh",
    [
      "gist", "create", "--public",
      "--desc", `stagecraft PR #${prNumber} screenshots`,
      readme,
    ]
  );
  const m = out.match(/gist\.github\.com\/(?:[^/]+\/)?([a-f0-9]{20,})/);
  if (!m) throw new Error(`Could not parse gist URL from output: ${out}`);
  return m[1];
}

function syncFilesToGist(gistId, gistUser, files) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pr-gist-sync-"));
  const remote = `https://${gistUser}:${process.env.GIST_TOKEN}@gist.github.com/${gistId}.git`;
  run("git", ["clone", "--depth", "1", remote, tmp]);
  for (const f of files) {
    fs.copyFileSync(f, path.join(tmp, path.basename(f)));
  }
  const status = run("git", ["status", "--porcelain"], { cwd: tmp });
  if (status) {
    run("git", ["add", "-A"], { cwd: tmp });
    run(
      "git",
      [
        "-c", `user.name=${BOT_NAME}`,
        "-c", `user.email=${BOT_EMAIL}`,
        "commit", "-m", `Update PR #${process.env.PR_NUMBER} screenshots`,
      ],
      { cwd: tmp }
    );
    run("git", ["push"], { cwd: tmp });
  } else {
    console.log("[gist] no changes to push");
  }
  // Return the (new or existing) gist HEAD SHA. Pinning raw URLs to an
  // immutable revision busts GitHub's raw-CDN cache — the revision-less
  // /raw/<file> form can serve a stale image for its TTL after a re-run.
  return run("git", ["rev-parse", "HEAD"], { cwd: tmp });
}

function escapeForRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function rewriteBody(body, files, gistUser, gistId, gistSha) {
  const rawBase = `https://gist.githubusercontent.com/${gistUser}/${gistId}/raw`;
  const referencedNames = new Set();
  let next = body || "";

  for (const f of files) {
    const basename = path.basename(f);
    const name = basename.replace(/\.[^.]+$/, "");
    const enc = encodeURIComponent(basename);
    // SHA-pinned (immutable) raw URL — see syncFilesToGist.
    const url = `${rawBase}/${gistSha}/${enc}`;

    const placeholder = new RegExp(
      `<!--\\s*screenshot:${escapeForRegex(name)}\\s*-->`,
      "g"
    );
    if (placeholder.test(next)) {
      next = next.replace(placeholder, `![${name}](${url})`);
      referencedNames.add(name);
      continue;
    }

    // Already embedded from a prior run? Repoint it at the new revision so
    // an updated screenshot doesn't render stale. Matches both the
    // SHA-pinned form (/raw/<sha>/<file>) and the older revision-less one
    // (/raw/<file>).
    const existing = new RegExp(
      `${escapeForRegex(rawBase)}/(?:[0-9a-f]+/)?${escapeForRegex(enc)}`,
      "g"
    );
    if (existing.test(next)) {
      next = next.replace(existing, url);
      referencedNames.add(name);
    }
  }

  const unreferenced = files.filter(
    (f) => !referencedNames.has(path.basename(f).replace(/\.[^.]+$/, ""))
  );

  if (unreferenced.length) {
    const lines = ["", "## Screenshots", ""];
    for (const f of unreferenced) {
      const basename = path.basename(f);
      const name = basename.replace(/\.[^.]+$/, "");
      lines.push(`![${name}](${rawBase}/${gistSha}/${encodeURIComponent(basename)})`);
    }
    lines.push("");
    next = `${next.replace(/\s+$/, "")}\n${lines.join("\n")}`;
  }

  if (!MARKER_RE.test(next)) {
    next = `${next.replace(/\s+$/, "")}\n\n<!-- screenshot-gist: ${gistId} -->\n`;
  }
  return next;
}

function cleanupCommit(headRef, prNumber) {
  const files = listScreenshots();
  if (!files.length) return;
  for (const f of files) run("git", ["rm", "-f", f]);
  run("git", [
    "-c", `user.name=${BOT_NAME}`,
    "-c", `user.email=${BOT_EMAIL}`,
    "commit", "-m",
    `chore: drop uploaded PR #${prNumber} screenshots [skip ci]`,
  ]);
  try {
    run("git", ["push", "origin", `HEAD:${headRef}`]);
  } catch (e) {
    // Fork PRs are already skipped by the workflow's `if:` guard, so the
    // usual cause here is a non-fast-forward push — the branch advanced
    // while the job ran. The screenshots stay on the branch; the next push
    // re-triggers this workflow, which cleans them up then.
    console.warn(
      `[cleanup] could not push cleanup commit (branch may have advanced): ${e.message}`
    );
  }
}

function main() {
  const prNumber = process.env.PR_NUMBER;
  const headRef = process.env.PR_HEAD_REF;
  if (!prNumber || !headRef) {
    console.error("PR_NUMBER and PR_HEAD_REF env vars are required");
    process.exit(2);
  }
  if (!process.env.GIST_TOKEN) {
    console.error(
      "GIST_TOKEN secret is not set.\n" +
        "Create a PAT with `gist` scope and add it as a repository secret " +
        "named GIST_TOKEN. See .github/workflows/pr-screenshots.yml for context."
    );
    process.exit(1);
  }

  const files = listScreenshots();
  console.log(`[scan] found ${files.length} file(s) in ${SCREENSHOTS_DIR}/`);
  if (!files.length) {
    console.log("[scan] nothing to do");
    return;
  }

  const body = getPrBody(prNumber);
  const existingId = (body.match(MARKER_RE) || [])[1];
  const gistUser = gistUserLogin();

  let gistId = existingId;
  if (!gistId) {
    console.log("[gist] no existing marker — creating new gist");
    gistId = createGist(prNumber);
    console.log(`[gist] created ${gistId}`);
  } else {
    console.log(`[gist] reusing existing gist ${gistId}`);
  }

  console.log(`[gist] syncing ${files.length} file(s)`);
  const gistSha = syncFilesToGist(gistId, gistUser, files);

  const newBody = rewriteBody(body, files, gistUser, gistId, gistSha);
  if (newBody !== body) {
    console.log("[pr] updating body");
    setPrBody(prNumber, newBody);
  } else {
    console.log("[pr] body already current");
  }

  console.log("[cleanup] removing uploaded files from PR branch");
  cleanupCommit(headRef, prNumber);
  console.log("[done]");
}

main();
