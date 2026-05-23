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
 *   keep the shared `draft` branch: no behavior change.
 * - On a multi-editor site, the first/owner editor keeps `draft` (so a
 *   site that adds collaborators doesn't orphan the owner's pending
 *   work), and every other editor gets an isolated `draft/<editorKey>`
 *   branch so concurrent edits and publishes don't clobber each other.
 *
 * An empty `editorEmail` (no identifiable editor) falls back to the
 * shared `draft`.
 */
export function resolveDraftBranch(editorEmail: string): string {
  const normalized = editorEmail.trim().toLowerCase();
  if (!normalized) return DRAFT_BRANCH;

  const editors = getAllowedEditorEmails();
  if (editors.length <= 1) return DRAFT_BRANCH;
  if (normalized === editors[0]) return DRAFT_BRANCH;
  return `${DRAFT_BRANCH}/${editorKey(normalized)}`;
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
