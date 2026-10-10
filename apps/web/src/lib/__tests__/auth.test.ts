import { describe, expect, it, vi } from "vitest";

const { nextAuthMock, githubProviderMock } = vi.hoisted(() => ({
  nextAuthMock: vi.fn(() => ({ handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() })),
  githubProviderMock: vi.fn((options: unknown) => ({ id: "github", options })),
}));

vi.mock("next-auth", () => ({ default: nextAuthMock }));
vi.mock("next-auth/providers/github", () => ({ default: githubProviderMock }));
vi.mock("@auth/prisma-adapter", () => ({ PrismaAdapter: vi.fn(() => ({})) }));
vi.mock("@stagecraft/db", () => ({ prisma: {} }));
vi.mock("../auth-credentials", () => ({
  upsertGithubIntegration: vi.fn(),
  withEncryptedAccountTokens: vi.fn((adapter: unknown) => adapter),
}));

import "../auth";
import { GITHUB_OAUTH_SCOPE } from "../github-oauth-scope";

describe("auth", () => {
  it("signs in with GitHub using GITHUB_OAUTH_SCOPE", () => {
    expect(githubProviderMock).toHaveBeenCalledTimes(1);
    const [options] = githubProviderMock.mock.calls[0] as [
      { authorization?: { params?: { scope?: string } } },
    ];
    expect(options.authorization?.params?.scope).toBe(GITHUB_OAUTH_SCOPE);
    expect(options.authorization?.params?.scope?.split(" ")).not.toContain("delete_repo");
  });

  it("passes the GitHub provider to NextAuth", () => {
    expect(nextAuthMock).toHaveBeenCalledTimes(1);
    const [config] = nextAuthMock.mock.calls[0] as unknown as [{ providers: unknown[] }];
    expect(config.providers).toEqual([githubProviderMock.mock.results[0].value]);
  });
});
