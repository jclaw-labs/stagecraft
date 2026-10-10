import type { Adapter, AdapterSession } from "next-auth/adapters";
import { prisma } from "@stagecraft/db";
import { hashSessionToken, isSessionTokenHash } from "@stagecraft/shared";

/**
 * Wrap the NextAuth adapter so `Session.sessionToken` holds
 * `sha256(sessionToken)` (hex) instead of the raw token (issue #411). The
 * session cookie still carries the raw token; every adapter call hashes it
 * before touching the table, so a leaked database dump holds nothing that
 * can be sent back as a cookie. Sessions handed back to Auth.js carry the
 * raw token again, because Auth.js sets the cookie from
 * `createSession(...).sessionToken`.
 *
 * Legacy plaintext rows (written before this wrapper) are migrated lazily:
 * when the hash finds no row, the raw token is tried, and a row stored under
 * it is rewritten to the hash in place, so existing users stay signed in.
 * The fallback never runs for a cookie shaped like a stored hash; otherwise
 * a hash lifted from a dump could be sent as the cookie and match its own
 * row through the plaintext lookup. Auth.js issues UUID tokens, which never
 * have that shape.
 *
 * TODO(#411): the plaintext fallback (`migrateLegacySession` and its
 * callers) can be removed once the 30-day session maxAge has passed since
 * this shipped: every plaintext row left by then has expired.
 */
export function withHashedSessionTokens(adapter: Adapter): Adapter {
  const { createSession, getSessionAndUser, updateSession, deleteSession } = adapter;
  if (!createSession || !getSessionAndUser || !updateSession || !deleteSession) return adapter;

  const withRawToken = <T extends AdapterSession>(session: T, token: string): T => ({
    ...session,
    sessionToken: token,
  });

  return {
    ...adapter,
    async createSession(session) {
      const created = await createSession({
        ...session,
        sessionToken: await hashSessionToken(session.sessionToken),
      });
      return withRawToken(created, session.sessionToken);
    },

    async getSessionAndUser(token) {
      const hashed = await hashSessionToken(token);
      let found = await getSessionAndUser(hashed);
      if (!found && (await migrateLegacySession(token, hashed))) {
        found = await getSessionAndUser(hashed);
      }
      return found ? { ...found, session: withRawToken(found.session, token) } : null;
    },

    async updateSession(session) {
      const hashed = await hashSessionToken(session.sessionToken);
      await migrateLegacySession(session.sessionToken, hashed);
      const updated = await updateSession({ ...session, sessionToken: hashed });
      return updated ? withRawToken(updated, session.sessionToken) : updated;
    },

    async deleteSession(token): Promise<AdapterSession | null | undefined> {
      const hashed = await hashSessionToken(token);
      await migrateLegacySession(token, hashed);
      // Typed `void | AdapterSession | ...`; the Prisma adapter returns the row.
      const deleted = (await deleteSession(hashed)) as AdapterSession | null | undefined;
      return deleted ? withRawToken(deleted, token) : deleted;
    },
  };
}

/**
 * Rewrite a legacy row stored under the raw `token` to `hashed`. Returns
 * whether a row was rewritten. `updateMany` rather than `update`, so a
 * missing row (the usual case) or a concurrent request that already
 * rewrote it is a no-op instead of an error.
 */
async function migrateLegacySession(token: string, hashed: string): Promise<boolean> {
  if (isSessionTokenHash(token)) return false;
  const { count } = await prisma.session.updateMany({
    where: { sessionToken: token },
    data: { sessionToken: hashed },
  });
  return count > 0;
}
