/**
 * Operator-only escape hatches. Email match must be exact and
 * case-insensitive. Kept as a hardcoded list rather than an env var
 * because (a) it's only ever one email today, and (b) putting an env
 * var here would be the kind of thing a future deploy could
 * accidentally clear, granting these tools to nobody.
 *
 * The session.user.email used for the comparison is set on first
 * sign-in from the Resend-verified address (see ConnectResend); it's
 * the same identity used as ADMIN_EMAIL on artist sites.
 */
const STAGECRAFT_ADMIN_EMAILS = ["jclaw3456@gmail.com"] as const;

export function isStagecraftAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  return STAGECRAFT_ADMIN_EMAILS.some((allowed) => allowed.toLowerCase() === normalized);
}
