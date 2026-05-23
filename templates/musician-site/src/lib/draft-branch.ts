import { createHash } from "node:crypto";

import { getAllowedEditorEmails, getSession } from "./auth";

/**
 * Persistent companion branch for ADR-010's two-branch publish model.
 * Single-editor sites (the default) read/write/publish this one shared
 * branch. Moved here from publish.ts so the constant and the per-editor
 * resolver below live together (ADR-011).
 */
export const DRAFT_BRANCH = "draft";

/**
 * Short, ref-safe, stable key for an editor, derived from their
 * normalized email. Hashed rather than embedding the raw email so the
 * branch name carries no PII and is always a valid git ref component.
 */
function editorKey(normalizedEmail: string): string {
  return createHash("sha256").update(normalizedEmail).digest("hex").slice(0, 12);
}

/**
 * Which draft branch a given editor reads / writes / publishes (ADR-011).
 *
 * - Single-editor sites (0 or 1 allowed editor — the default today)
 *   use the shared `draft` branch: no behavior change.
 * - On a multi-editor site every editor gets an isolated branch keyed
 *   on their OWN email — `draft-<editorKey>`. Keying on the editor's
 *   own hash (not their position in `ADMIN_EMAILS`) makes the mapping
 *   stable across env-var edits/reordering. The separator is a hyphen,
 *   not a slash: `refs/heads/draft` (a file) and `refs/heads/draft/x`
 *   (which needs `draft` to be a directory) cannot coexist in git, but
 *   `refs/heads/draft-x` is a sibling ref that can.
 *
 * An empty `editorEmail` (no identifiable editor) falls back to the
 * shared `draft`.
 *
 * Migration note: when a single-editor site first gains a second
 * editor, the original editor moves from `draft` to their own
 * `draft-<key>`; unpublished work still on `draft` is not auto-carried
 * (it stays recoverable on `draft`). See ADR-011 known limitations.
 */
export function resolveDraftBranch(editorEmail: string): string {
  const normalized = editorEmail.trim().toLowerCase();
  if (!normalized) return DRAFT_BRANCH;

  const editors = getAllowedEditorEmails();
  if (editors.length <= 1) return DRAFT_BRANCH;
  return `${DRAFT_BRANCH}-${editorKey(normalized)}`;
}

/**
 * Resolve the draft branch for the current request from the signed-in
 * editor's session. Used by the read + pending-changes paths, which
 * don't carry an explicit author argument the way the write path does.
 *
 * Returns the shared `draft` when no editor can be identified — no
 * session, or called outside a request scope (e.g. a unit test, where
 * `cookies()` throws). That's the safe default and keeps single-editor
 * sites on one branch regardless.
 */
export async function resolveDraftBranchForRequest(): Promise<string> {
  let email = "";
  try {
    email = (await getSession())?.email ?? "";
  } catch {
    email = "";
  }
  return resolveDraftBranch(email);
}
