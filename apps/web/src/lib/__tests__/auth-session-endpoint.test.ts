import { describe, expect, it, vi } from "vitest";

import { Auth, type AuthConfig } from "@auth/core";

// Runs the app's Auth.js config through the real @auth/core handler for
// GET /api/auth/session, with a stub database adapter in place of Prisma,
// and checks the JSON body the browser receives.
const { userRow, sessionRow, nextAuthMock } = vi.hoisted(() => {
  const userRow = {
    id: "user-1",
    name: "Ada",
    email: "ada@example.com",
    emailVerified: new Date("2026-01-01T00:00:00Z"),
    image: "https://example.com/ada.png",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-02-01T00:00:00Z"),
  };
  const sessionRow = {
    id: "session-row-1",
    sessionToken: "raw-cookie-value",
    userId: "user-1",
    expires: new Date(Date.now() + 86_400_000),
  };
  const nextAuthMock = vi.fn((_config: unknown) => ({}));
  return { userRow, sessionRow, nextAuthMock };
});

vi.mock("next-auth", () => ({ default: nextAuthMock }));
vi.mock("@auth/prisma-adapter", () => ({
  PrismaAdapter: () => ({
    // Auth.js asserts these exist for database sessions; this request never calls them.
    ...Object.fromEntries(
      [
        "createUser",
        "getUser",
        "getUserByEmail",
        "getUserByAccount",
        "updateUser",
        "linkAccount",
        "createSession",
      ].map((name) => [name, vi.fn()]),
    ),
    getSessionAndUser: async () => ({ session: { ...sessionRow }, user: { ...userRow } }),
    updateSession: async () => null,
    deleteSession: async () => null,
  }),
}));
vi.mock("@stagecraft/db", () => ({ prisma: {} }));
vi.mock("../auth-credentials", () => ({
  upsertGithubIntegration: vi.fn(),
  withEncryptedAccountTokens: (adapter: unknown) => adapter,
}));
vi.mock("../auth-session-tokens", () => ({
  withHashedSessionTokens: (adapter: unknown) => adapter,
}));

describe("GET /api/auth/session", () => {
  it("returns only user { id, name, email } and expires", async () => {
    await import("../auth");
    const config = nextAuthMock.mock.calls[0][0] as AuthConfig;
    const res = await Auth(
      new Request("http://localhost/api/auth/session", {
        headers: { cookie: `authjs.session-token=${sessionRow.sessionToken}` },
      }),
      { ...config, secret: "test-secret", basePath: "/api/auth" },
    );
    const text = await res.text();
    expect(text).not.toContain(sessionRow.sessionToken);
    expect(JSON.parse(text)).toEqual({
      user: { id: "user-1", name: "Ada", email: "ada@example.com" },
      expires: expect.any(String),
    });
  });
});
