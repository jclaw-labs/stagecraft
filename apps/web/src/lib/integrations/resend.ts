import { prisma } from "@stagecraft/db";

/**
 * Resend integration — each artist connects their own Resend account at
 * /settings → Connect Resend. The platform stores the API key + their
 * preferred from-address; at /create time we provision both as env vars
 * on the new site (`RESEND_API_KEY`, `MAGIC_LINK_FROM`) so the artist
 * site sends magic-link emails directly from the artist's own Resend
 * account. The platform never sees recipient addresses or sends mail
 * on the artist's behalf.
 */

const RESEND_API = "https://api.resend.com";

/**
 * Resend's pre-verified sandbox sender — works on every account,
 * including send-only API keys, but only delivers to the email used
 * to register that Resend account. We use this for everything for
 * now: stagecraft-internal verification codes AND artist-site
 * magic-link emails (which always go to ADMIN_EMAIL = User.email =
 * Resend account email, so sandbox always reaches them).
 *
 * Future: per-site override to use a custom domain when the artist
 * has verified one on their Resend account AND hooked it up to the
 * Stagecraft site.
 */
export const RESEND_SANDBOX_FROM = "onboarding@resend.dev";

/**
 * Custom error thrown by sendResendEmail when Resend rejects with the
 * specific 403 it returns when sending to a non-account email via the
 * sandbox sender (its only-deliver-to-account-email constraint). The
 * caller surfaces this as a tailored UX message instead of leaking
 * the raw Resend body.
 */
export class ResendRecipientNotAllowedError extends Error {
  constructor(public readonly recipient: string) {
    super(
      `Resend's sandbox sender can only deliver to the email you signed up with — ${recipient} doesn't match.`,
    );
    this.name = "ResendRecipientNotAllowedError";
  }
}

export interface ResendDomain {
  id: string;
  name: string;
  status: "pending" | "verified" | "temporary_failure" | "failed" | string;
}

export interface ResendTokenInfo {
  domains: ResendDomain[];
  /**
   * True when the API key is restricted to sending only — Resend hands
   * these out by default at signup ("Sending access" keys), and they
   * can't list domains. The artist can still send via Resend's sandbox
   * sender (`onboarding@resend.dev`) without giving us a full-access
   * key. Domains is always [] when restricted.
   */
  restricted: boolean;
}

/**
 * Validate a Resend API key by listing domains. Returns the list (status
 * included) so the UI can suggest verified sender addresses. Returns
 * `restricted: true` (not throwing) when the key is send-only —
 * the connect flow handles that by forcing the Resend sandbox sender.
 * Throws on any other non-2xx response.
 */
export async function validateResendToken(token: string): Promise<ResendTokenInfo> {
  const res = await fetch(`${RESEND_API}/domains`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text();
    if (res.status === 401) {
      try {
        const parsed = JSON.parse(body) as { name?: string };
        if (parsed.name === "restricted_api_key") {
          return { domains: [], restricted: true };
        }
      } catch {
        // fall through to generic error
      }
    }
    throw new Error(`Resend API error (${res.status}): ${body}`);
  }
  const json = (await res.json()) as { data?: ResendDomain[] };
  return { domains: json.data ?? [], restricted: false };
}

export interface ResendCredentials {
  apiKey: string;
}

/**
 * Look up the artist's connected Resend credentials for `userId`. Used
 * by `handleCreateSite` to provision env vars on the new artist site.
 * Returns null when the artist hasn't connected Resend.
 *
 * The verified admin email lives on `User.email` (the Resend connect
 * flow writes it there); the sender is hardcoded to RESEND_SANDBOX_FROM
 * for every send right now. Both decoupled from this struct so it
 * stays minimal.
 */
export async function getResendCredentials(userId: string): Promise<ResendCredentials | null> {
  const integration = await prisma.integrationAccount.findUnique({
    where: { userId_provider: { userId, provider: "resend" } },
  });
  if (!integration?.accessToken) return null;
  return { apiKey: integration.accessToken };
}

/**
 * Send a transactional email via Resend. Used at /settings → Connect
 * Resend to send the verification code to the artist's chosen admin
 * email; the artist site itself sends magic-link emails directly via
 * `resend` SDK from its template code.
 */
export async function sendResendEmail(args: {
  apiKey: string;
  from: string;
  to: string;
  subject: string;
  text: string;
}): Promise<void> {
  const res = await fetch(`${RESEND_API}/emails`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: args.from,
      to: args.to,
      subject: args.subject,
      text: args.text,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    if (res.status === 403) {
      // Resend's "only deliver to your account email" guard — body
      // looks like {"name":"validation_error","message":"You can only
      // send testing emails to your own email address (X)..."}. Throw
      // the typed error so callers can show a specific UX message.
      try {
        const parsed = JSON.parse(body) as { name?: string; message?: string };
        if (
          parsed.name === "validation_error" &&
          parsed.message?.includes("only send testing emails")
        ) {
          throw new ResendRecipientNotAllowedError(args.to);
        }
      } catch (e) {
        if (e instanceof ResendRecipientNotAllowedError) throw e;
      }
    }
    throw new Error(`Resend send failed (${res.status}): ${body}`);
  }
}
