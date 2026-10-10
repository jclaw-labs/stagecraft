/**
 * Hashing for NextAuth database session tokens (issue #411).
 *
 * The `Session` table stores `sha256(sessionToken)` as lowercase hex, not
 * the token itself; the session cookie still carries the raw token. A
 * leaked database dump then holds only hashes, which can't be sent back as
 * a cookie: the app hashes whatever the cookie carries before looking it up.
 *
 * WebCrypto (`globalThis.crypto.subtle`), so it runs on Node 20+ and on
 * Cloudflare Workers alike.
 */

const SESSION_TOKEN_HASH_PATTERN = /^[0-9a-f]{64}$/;

/** The value stored in `Session.sessionToken` for a raw cookie token. */
export async function hashSessionToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * True when `value` has the shape of a stored hash (64 lowercase hex
 * characters). Auth.js issues session tokens as UUIDs, which never have
 * this shape, so a cookie that does is a stored hash being replayed and
 * must not be looked up as a legacy plaintext token.
 */
export function isSessionTokenHash(value: string): boolean {
  return SESSION_TOKEN_HASH_PATTERN.test(value);
}
