import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@stagecraft/db";
import { upsertGithubIntegration, withEncryptedAccountTokens } from "./auth-credentials";
import { withHashedSessionTokens } from "./auth-session-tokens";
import { GITHUB_OAUTH_SCOPE } from "./github-oauth-scope";

export const { handlers, auth, signIn, signOut } = NextAuth({
  // OAuth tokens are encrypted before they reach `Account`, and `Session`
  // stores a hash of the session token, not the token (ADR-005). The hash
  // wrapper's legacy fallback skips cookies shaped like a stored hash (64
  // hex chars); Auth.js's default UUID tokens never are, so keep the default
  // `session.generateSessionToken` until that fallback is removed.
  adapter: withHashedSessionTokens(withEncryptedAccountTokens(PrismaAdapter(prisma))),
  // NextAuth v5 doesn't trust the request Host off Vercel by default — even
  // when it matches AUTH_URL. On Netlify, functions are only reachable via
  // the edge (which controls the Host header), so trusting it is safe.
  trustHost: true,
  providers: [
    GitHub({
      // Each scope's reason lives in github-oauth-scope.ts.
      authorization: { params: { scope: GITHUB_OAUTH_SCOPE } },
    }),
  ],
  pages: {
    signIn: "/login",
  },
  callbacks: {
    // With database sessions Auth.js passes the adapter's Session row merged
    // with the User row, and sends what this returns as the body of
    // /api/auth/session. Return exactly `{ user: { id, name, email }, expires }`
    // (the fields the app reads), built field by field so the raw session
    // token (the HttpOnly cookie's value), userId and any other User column
    // stay off that endpoint.
    session({ session, user }) {
      return {
        user: { id: user.id, name: user.name, email: user.email },
        expires: session.expires,
      };
    },
  },
  events: {
    async signIn({ user, account }) {
      if (account?.provider === "github" && user.id && account.access_token) {
        const ghUser = await fetch("https://api.github.com/user", {
          headers: { Authorization: `Bearer ${account.access_token}` },
        }).then((r) => r.json() as Promise<{ id: number; login: string }>);

        await upsertGithubIntegration({
          userId: user.id,
          accessToken: account.access_token,
          githubUser: ghUser,
        });
      }
    },
  },
});
