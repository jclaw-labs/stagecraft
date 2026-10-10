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

    // A full Prisma `User` row and `Session` row, passed the way
    // @auth/core does: one adapter user object as both `session.user` and `user`.
    type UserRow = {
      id: string;
      name: string | null;
      email: string | null;
      emailVerified: Date | null;
      image: string | null;
      createdAt: Date;
      updatedAt: Date;
    };
    const adapterUser = (): UserRow => ({
      id: "user-1",
      name: "Ada",
      email: "ada@example.com",
      emailVerified: new Date("2026-01-01T00:00:00Z"),
      image: "https://example.com/ada.png",
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-02-01T00:00:00Z"),
    });
    const callWithRows = (user = adapterUser()) =>
      sessionCallback()({
        session: {
          id: "session-row-1",
          sessionToken: "raw-cookie-value",
          userId: user.id,
          expires,
          user,
        },
        user,
      });

    it("returns only user and expires, dropping the session token and userId", () => {
      const result = callWithRows();
      expect(Object.keys(result).sort()).toEqual(["expires", "user"]);
      expect(result.expires).toBe(expires);
    });

    it("returns only id, name and email from the User row", () => {
      const result = callWithRows();
      expect(Object.keys(result.user as object).sort()).toEqual(["email", "id", "name"]);
      expect(result.user).toEqual({ id: "user-1", name: "Ada", email: "ada@example.com" });
    });

    it("keeps a null name and email as null", () => {
      const result = callWithRows({ ...adapterUser(), id: "user-2", name: null, email: null });
      expect(result.user).toEqual({ id: "user-2", name: null, email: null });
    });
  });
});
