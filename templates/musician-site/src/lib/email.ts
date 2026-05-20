import { Resend } from "resend";

/**
 * Resend's sandbox sender. Works without a verified domain — every
 * artist can send from this on day one. Artists who connect their own
 * verified domain on the platform get `MAGIC_LINK_FROM` set explicitly
 * to override.
 */
export const MAGIC_LINK_FROM_DEFAULT = "onboarding@resend.dev";

function resolveFromAddress(): string {
  return process.env.MAGIC_LINK_FROM || MAGIC_LINK_FROM_DEFAULT;
}

/**
 * True when outgoing mail still uses Resend's shared sandbox sender —
 * no verified domain has been provisioned. In that mode Resend will
 * only deliver `to:` addresses that are verified on the account, so
 * the contact email and the admin sign-in email have to match.
 */
export function isResendSandboxSender(): boolean {
  return resolveFromAddress() === MAGIC_LINK_FROM_DEFAULT;
}

/**
 * Send the magic-link email via Resend. `RESEND_API_KEY` is provisioned
 * per-site by the platform's /create flow from the artist's own Resend
 * account (set up at /settings on the platform), so each artist site
 * uses its owner's account end-to-end — the platform never sees
 * recipient addresses or sends mail on behalf of any artist.
 *
 * `MAGIC_LINK_FROM` defaults to Resend's sandbox sender; artists who
 * have a verified domain get it provisioned explicitly so emails come
 * from their own domain.
 *
 * In local dev RESEND_API_KEY is typically unset and we log to stderr
 * instead of sending.
 */
export async function sendMagicLink(email: string, url: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log(`[dev] Magic link for ${email}: ${url}`);
    return;
  }
  const resend = new Resend(apiKey);
  await resend.emails.send({
    from: resolveFromAddress(),
    to: email,
    subject: "Sign in to your site",
    text: `Click this link to sign in:\n\n${url}\n\nThis link expires in 10 minutes. If you didn't request it, ignore this email.`,
  });
}

export type ContactMessage = {
  /** Recipient — the site's `contactEmail` from `site.json`. */
  to: string;
  /** Submitter's email, used as `replyTo` so the artist can hit reply. */
  replyTo: string;
  /** Submitter's name — used in the message body. */
  fromName: string;
  /** Subject from the form (already prefixed by the route). */
  subject: string;
  /** Message body — plain text. */
  body: string;
  /** Artist site name, used as the friendly part of the `from:` header. */
  siteName: string;
};

/**
 * Send a contact-form submission to the artist via Resend. Mirrors
 * `sendMagicLink`: same `RESEND_API_KEY` env, same `MAGIC_LINK_FROM`
 * override. The submitter never sees the artist's address — the
 * outgoing mail is `from: <siteName> <MAGIC_LINK_FROM>`, addressed
 * to `contactEmail`, with `replyTo` set to the submitter so a reply
 * goes back to them.
 */
export async function sendContactEmail(message: ContactMessage): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log(
      `[dev] Contact message for ${message.to} from ${message.fromName} <${message.replyTo}>: ${message.subject}`,
    );
    return;
  }
  const resend = new Resend(apiKey);
  await resend.emails.send({
    from: `${message.siteName} <${resolveFromAddress()}>`,
    to: message.to,
    replyTo: message.replyTo,
    subject: message.subject,
    text: [
      `Name: ${message.fromName}`,
      `Email: ${message.replyTo}`,
      `Subject: ${message.subject}`,
      "",
      message.body,
    ].join("\n"),
  });
}
