import type { Adapter, AdapterAccount } from "next-auth/adapters";
import { prisma } from "@stagecraft/db";
import { encryptCredential, encryptOptionalCredential } from "./credential-crypto";

/**
 * Wrap the NextAuth adapter so the OAuth tokens it stores on `Account`
 * (`access_token`, `refresh_token`, `id_token`) are encrypted at rest.
 * Nothing in the app reads them back from `Account`; the GitHub token the
 * platform uses lives on `IntegrationAccount` (see `upsertGithubIntegration`).
 * NextAuth hands the plaintext `account` to the `signIn` event separately,
 * so encrypting here doesn't affect that event.
 */
export function withEncryptedAccountTokens(adapter: Adapter): Adapter {
  const { linkAccount } = adapter;
  if (!linkAccount) return adapter;
  return {
    ...adapter,
    // NextAuth ignores linkAccount's result, so this returns nothing.
    async linkAccount(account: AdapterAccount): Promise<void> {
      await linkAccount({
        ...account,
        access_token: await encryptOptionalCredential(account.access_token),
        refresh_token: await encryptOptionalCredential(account.refresh_token),
        id_token: await encryptOptionalCredential(account.id_token),
      });
    },
  };
}

/**
 * Store the artist's GitHub OAuth token, encrypted, on their GitHub
 * `IntegrationAccount`, the row `lib/integrations/github.ts` reads.
 * Called from NextAuth's `signIn` event with the plaintext token.
 */
export async function upsertGithubIntegration(args: {
  userId: string;
  accessToken: string;
  githubUser: { id: number; login: string };
}): Promise<void> {
  const accessToken = await encryptCredential(args.accessToken);
  await prisma.integrationAccount.upsert({
    where: {
      userId_provider: { userId: args.userId, provider: "github" },
    },
    update: {
      accessToken,
      providerAccountId: String(args.githubUser.id),
      metadata: { login: args.githubUser.login },
      updatedAt: new Date(),
    },
    create: {
      userId: args.userId,
      provider: "github",
      providerAccountId: String(args.githubUser.id),
      accessToken,
      scopes: "repo workflow",
      metadata: { login: args.githubUser.login },
    },
  });
}
