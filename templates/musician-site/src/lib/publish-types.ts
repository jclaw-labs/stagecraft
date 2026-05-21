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

/** Request body sent from the editor to /api/publish on the artist site. */
export const publishRequestSchema = z.object({
  pageSlug: z.string().min(1).regex(/^[a-z0-9][a-z0-9-]*$/),
  data: z.unknown(),
});
export type PublishRequest = z.infer<typeof publishRequestSchema>;

export const publishResponseSchema = z.object({
  ok: z.literal(true),
  commitSha: z.string().nullable(),
});
export type PublishResponse = z.infer<typeof publishResponseSchema>;

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
 * Map a `PublishError` code to the HTTP status the failure-response
 * routes should return. Centralises the mapping so the three routes
 * that emit structured failures (`/api/publish`, `/api/publish-draft`,
 * `/api/upload-image`) can't drift apart on which code is which
 * status.
 *
 * - `broker-rejected` → 502 (upstream said no)
 * - `concurrent-edit` → 409 (recoverable client-side: refresh + retry)
 * - everything else  → 500 (generic server-side failure)
 *
 * Save routes that already absorb publish failures into a 200-OK +
 * `publishWarning` envelope (the local-write-succeeded path) don't
 * use this helper — their response doesn't have a status to map.
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
