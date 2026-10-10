import { z } from "zod";

/**
 * Contract between the artist site and the platform's token broker.
 *
 * - Artist site POSTs to the broker with its session token (cookie) and a siteId.
 * - Broker validates, mints a GitHub installation token, and returns it along
 *   with the target repo. Token is short-lived (~1hr).
 *
 * See ADR-008 for the full design.
 */
export const publishTokenRequestSchema = z.object({
  siteId: z.string().min(1),
});
export type PublishTokenRequest = z.infer<typeof publishTokenRequestSchema>;

export const publishTokenResponseSchema = z.object({
  ok: z.literal(true),
  token: z.string().min(1),
  expiresAt: z.string().datetime(),
  repo: z.object({
    owner: z.string().min(1),
    name: z.string().min(1),
  }),
});
export type PublishTokenResponse = z.infer<typeof publishTokenResponseSchema>;

export const publishErrorSchema = z.object({
  ok: z.literal(false),
  error: z.string(),
  code: z.enum([
    "unauthorized",
    "broker-unreachable",
    "broker-rejected",
    "github-failed",
    "validation-failed",
    "no-platform-configured",
    // ADR-010 §6: emitted when commitFiles' bounded retry-on-stale-
    // ref loop exhausts. Distinct from `github-failed` so the editor
    // can surface a "someone else just saved — refresh to see latest"
    // message and offer a Reload action instead of a generic error.
    "concurrent-edit",
  ]),
});
export type PublishError = z.infer<typeof publishErrorSchema>;

/**
 * Non-fatal follow-ups a *successful* publish can carry back to the
 * editor (`warning` on the `/api/publish-selected` success envelope).
 * The publish shipped — `main` has the change and the deploy fired —
 * but something after it didn't finish (ADR-012 "Concurrency & partial
 * failure"):
 *
 * - `draft-resync-pending`: reconciling the editor's draft with the new
 *   `main` failed transiently. The draft self-heals on the next save's
 *   auto-rebase; until then the pending list can still show the
 *   published items.
 * - `draft-resync-conflict`: the draft can't merge the new `main`
 *   cleanly (another publish touched the same files). The next save
 *   would hit the same conflict, so the editor has to discard the
 *   remaining pending changes.
 */
export const publishWarningSchema = z.enum(["draft-resync-pending", "draft-resync-conflict"]);
export type PublishWarning = z.infer<typeof publishWarningSchema>;

/** Editor copy for each {@link PublishWarning}, shown under the Publish button. */
export const PUBLISH_WARNING_MESSAGES: Record<PublishWarning, string> = {
  "draft-resync-pending":
    "Your draft will resync with the live site on your next save — until then, published items may still show as pending.",
  "draft-resync-conflict":
    "Your remaining draft changes conflict with the live site. Discard them or contact support.",
};

/**
 * Map a `PublishError` code to the HTTP status the failure-response
 * routes should return. Centralises the mapping so the routes that
 * emit structured failures (`/api/publish-draft`,
 * `/api/publish-selected`, `/api/upload-image`) can't drift apart on
 * which code is which status.
 *
 * - `broker-rejected` → 502 (upstream said no)
 * - `concurrent-edit` → 409 (recoverable client-side: refresh + retry)
 * - everything else  → 500 (generic server-side failure)
 *
 * Content save routes (including the page editor's save) use
 * `saveFailureStatus` in `save-content.ts` instead: a save whose commit
 * fails didn't persist anywhere, so it's an upstream failure (502, or 409 / 503) rather than a generic 500.
 */
export function publishErrorHttpStatus(code: PublishError["code"]): number {
  switch (code) {
    case "broker-rejected":
      return 502;
    case "concurrent-edit":
      return 409;
    default:
      return 500;
  }
}

/**
 * Hard cap on the artist's override of the publish commit subject.
 * Mirrored on both sides of the wire: the `publish-draft` route
 * schema enforces it server-side, and the modal's
 * `<input maxLength={...}>` enforces it client-side. Keeping them
 * pinned to one constant avoids silent drift — raising the route's
 * `z.string().max()` without also raising the input would let the
 * artist type values the route still rejects.
 *
 * 200 matches what git tooling and most code-review surfaces show
 * before truncation; content longer than that usually belongs in a
 * body, not the subject.
 *
 * Kept distinct from `MAX_COMMIT_MESSAGE_LENGTH` because the
 * indicator's character counter is still subject-only for the
 * counter ramp's purpose — the cap a *subject* is too long, vs
 * "the whole message is too long" — but the route accepts a
 * multi-line message up to the larger length so the artist can
 * write a body if they want.
 */
export const MAX_COMMIT_SUBJECT_LENGTH = 200;

/**
 * Hard cap on the artist's override of the publish commit message
 * (subject + optional body, separated by a blank line per git
 * convention). The modal's `<textarea>` enforces this client-side
 * and the route's `z.string().max()` matches. Picked at 2000 to
 * accommodate a paragraph or two of free-form context without
 * letting the artist paste a novel.
 *
 * The first line of the message is the commit subject for `git
 * log --oneline`; lines after a blank line are the body. Our
 * route appends a `Stagecraft-Publish-Id` trailer after the
 * artist's message, so the artist's content never collides with
 * the trailer's namespace.
 */
export const MAX_COMMIT_MESSAGE_LENGTH = 2000;
