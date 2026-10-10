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
  withEncryptedAccountTokens: vi.fn((adapter: unknown) => ({ encrypted: adapter })),
}));
vi.mock("../auth-session-tokens", () => ({
  withHashedSessionTokens: vi.fn((adapter: unknown) => ({ hashed: adapter })),
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

  it("hashes session tokens on top of the encrypting adapter", () => {
    const [config] = nextAuthMock.mock.calls[0] as unknown as [{ adapter: unknown }];
    expect(config.adapter).toEqual({ hashed: { encrypted: {} } });
  });

  describe("session callback", () => {
    type SessionCallback = (params: {
      session: Record<string, unknown> & { user?: Record<string, unknown>; expires: unknown };
      user: { id: string };
    }) => Record<string, unknown>;
    const sessionCallback = () => {
      const [config] = nextAuthMock.mock.calls[0] as unknown as [
        { callbacks: { session: SessionCallback } },
      ];
      return config.callbacks.session;
    };
    const expires = new Date("2026-11-09T00:00:00Z");

    it("drops the session token and userId from the database session", () => {
      const result = sessionCallback()({
        session: {
          sessionToken: "raw-cookie-value",
          userId: "user-1",
          id: "session-row-1",
          expires,
          user: { id: "user-1", name: "Ada", email: "ada@example.com", image: null },
        },
        user: { id: "user-1" },
      });
      expect(result).toEqual({
        user: { id: "user-1", name: "Ada", email: "ada@example.com", image: null },
        expires,
      });
      expect(result).not.toHaveProperty("sessionToken");
      expect(result).not.toHaveProperty("userId");
      expect(result).not.toHaveProperty("id");
    });

    it("sets user.id from the adapter user", () => {
      const result = sessionCallback()({
        session: { expires, user: { name: "Ada" } },
        user: { id: "user-2" },
      });
      expect(result.user).toEqual({ name: "Ada", id: "user-2" });
    });

    it("leaves a missing user missing", () => {
      const result = sessionCallback()({ session: { expires }, user: { id: "user-3" } });
      expect(result).toEqual({ user: undefined, expires });
    });
  });
});
