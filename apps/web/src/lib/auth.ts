import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@stagecraft/db";
import { upsertGithubIntegration, withEncryptedAccountTokens } from "./auth-credentials";
import { withHashedSessionTokens } from "./auth-session-tokens";
import { GITHUB_OAUTH_SCOPE } from "./github-oauth-scope";

export const { handlers, auth, signIn, signOut } = NextAuth({
  // OAuth tokens are encrypted before they reach `Account`, and `Session`
  // stores a hash of the session token, not the token (ADR-005).
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
    session({ session, user }) {
      if (session.user) {
        session.user.id = user.id;
      }
      return session;
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
