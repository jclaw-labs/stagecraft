import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@stagecraft/db";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  // NextAuth v5 doesn't trust the request Host off Vercel by default — even
  // when it matches AUTH_URL. On Netlify, functions are only reachable via
  // the edge (which controls the Host header), so trusting it is safe.
  trustHost: true,
  providers: [
    GitHub({
      // `workflow` lets the platform's push (using this token) write files
      // under `.github/workflows/` on generated artist repos — required for
      // the Dependabot auto-merge workflow. It's a small add on top of the
      // `repo` access already granted.
      authorization: { params: { scope: "read:user user:email repo delete_repo workflow" } },
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

        await prisma.integrationAccount.upsert({
          where: {
            userId_provider: { userId: user.id, provider: "github" },
          },
          update: {
            accessToken: account.access_token,
            providerAccountId: String(ghUser.id),
            metadata: { login: ghUser.login },
            updatedAt: new Date(),
          },
          create: {
            userId: user.id,
            provider: "github",
            providerAccountId: String(ghUser.id),
            accessToken: account.access_token,
            scopes: "repo workflow",
            metadata: { login: ghUser.login },
          },
        });
      }
    },
  },
});
