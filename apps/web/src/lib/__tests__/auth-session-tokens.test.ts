import { createHash } from "node:crypto";
import type { Adapter, AdapterSession, AdapterUser } from "next-auth/adapters";
import { beforeEach, describe, expect, it, vi } from "vitest";

// An in-memory `Session` table shared by the fake adapter below and the
// `prisma.session.updateMany` the wrapper calls for legacy rows.
const { rows, prismaMock } = vi.hoisted(() => {
  const rows = new Map<string, { sessionToken: string; userId: string; expires: Date }>();
  const prismaMock = {
    session: {
      updateMany: vi.fn(
        async ({ where, data }: { where: { sessionToken: string }; data: { sessionToken: string } }) => {
          const row = rows.get(where.sessionToken);
          if (!row) return { count: 0 };
          rows.delete(where.sessionToken);
          rows.set(data.sessionToken, { ...row, sessionToken: data.sessionToken });
          return { count: 1 };
        },
      ),
    },
  };
  return { rows, prismaMock };
});

vi.mock("@stagecraft/db", () => ({ prisma: prismaMock }));

import { withHashedSessionTokens } from "../auth-session-tokens";

const RAW = "2f1c7a3e-5b8d-4e0f-9a6b-1c2d3e4f5a6b";
const HASHED = createHash("sha256").update(RAW).digest("hex");
const USER: AdapterUser = { id: "user-1", email: "a@example.com", emailVerified: null };
const EXPIRES = new Date("2026-11-01T00:00:00Z");
const LATER = new Date("2026-11-30T00:00:00Z");

/** Mirrors `@auth/prisma-adapter`: equality lookups, throws on a missing row. */
function fakeAdapter() {
  const missing = () => new Error("Record to update not found.");
  return {
    createSession: vi.fn(async (s: AdapterSession) => {
      rows.set(s.sessionToken, { ...s });
      return { ...s };
    }),
    getSessionAndUser: vi.fn(async (token: string) => {
      const row = rows.get(token);
      return row ? { session: { ...row }, user: USER } : null;
    }),
    updateSession: vi.fn(async (s: Partial<AdapterSession> & Pick<AdapterSession, "sessionToken">) => {
      const row = rows.get(s.sessionToken);
      if (!row) throw missing();
      const updated = { ...row, ...s };
      rows.set(s.sessionToken, updated);
      return { ...updated };
    }),
    deleteSession: vi.fn(async (token: string) => {
      const row = rows.get(token);
      if (!row) throw missing();
      rows.delete(token);
      return { ...row };
    }),
  };
}

function seed(sessionToken: string) {
  rows.set(sessionToken, { sessionToken, userId: USER.id, expires: EXPIRES });
}

let base: ReturnType<typeof fakeAdapter>;
let adapter: Required<Pick<Adapter, "createSession" | "getSessionAndUser" | "updateSession" | "deleteSession">>;

beforeEach(() => {
  rows.clear();
  prismaMock.session.updateMany.mockClear();
  base = fakeAdapter();
  adapter = withHashedSessionTokens(base as Adapter) as typeof adapter;
});

describe("withHashedSessionTokens", () => {
  it("returns the adapter unchanged when it has no session methods", () => {
    const bare = { getUser: vi.fn() } as unknown as Adapter;
    expect(withHashedSessionTokens(bare)).toBe(bare);
  });

  it("keeps the other adapter methods", () => {
    const getUser = vi.fn();
    const wrapped = withHashedSessionTokens({ ...base, getUser } as unknown as Adapter);
    expect(wrapped.getUser).toBe(getUser);
  });

  describe("createSession", () => {
    it("stores the hash and hands back the raw token for the cookie", async () => {
      const created = await adapter.createSession({ sessionToken: RAW, userId: USER.id, expires: EXPIRES });

      expect(base.createSession).toHaveBeenCalledWith({ sessionToken: HASHED, userId: USER.id, expires: EXPIRES });
      expect([...rows.keys()]).toEqual([HASHED]);
      expect(created).toEqual({ sessionToken: RAW, userId: USER.id, expires: EXPIRES });
    });
  });

  describe("getSessionAndUser", () => {
    it("finds a hashed row by the raw token", async () => {
      seed(HASHED);

      const found = await adapter.getSessionAndUser(RAW);

      expect(found).toEqual({
        session: { sessionToken: RAW, userId: USER.id, expires: EXPIRES },
        user: USER,
      });
      expect(base.getSessionAndUser).toHaveBeenCalledTimes(1);
      expect(base.getSessionAndUser).toHaveBeenCalledWith(HASHED);
      expect(prismaMock.session.updateMany).not.toHaveBeenCalled();
    });

    it("finds a legacy plaintext row and rewrites it to the hash", async () => {
      seed(RAW);

      const found = await adapter.getSessionAndUser(RAW);

      expect(found?.session).toEqual({ sessionToken: RAW, userId: USER.id, expires: EXPIRES });
      expect(found?.user).toEqual(USER);
      expect(prismaMock.session.updateMany).toHaveBeenCalledWith({
        where: { sessionToken: RAW },
        data: { sessionToken: HASHED },
      });
      expect([...rows.keys()]).toEqual([HASHED]);

      // The next lookup goes straight to the hash.
      prismaMock.session.updateMany.mockClear();
      expect(await adapter.getSessionAndUser(RAW)).not.toBeNull();
      expect(prismaMock.session.updateMany).not.toHaveBeenCalled();
    });

    it("returns null for a token with no session", async () => {
      seed(await sha256("someone-else"));

      expect(await adapter.getSessionAndUser(RAW)).toBeNull();
      expect(rows.size).toBe(1);
    });

    it("does not accept a stored hash sent as the cookie", async () => {
      seed(HASHED);

      expect(await adapter.getSessionAndUser(HASHED)).toBeNull();
      expect(base.getSessionAndUser).toHaveBeenCalledTimes(1);
      expect(base.getSessionAndUser).toHaveBeenCalledWith(await sha256(HASHED));
      expect(prismaMock.session.updateMany).not.toHaveBeenCalled();
    });
  });

  describe("updateSession", () => {
    it("updates a hashed row", async () => {
      seed(HASHED);

      const updated = await adapter.updateSession({ sessionToken: RAW, expires: LATER });

      expect(base.updateSession).toHaveBeenCalledWith({ sessionToken: HASHED, expires: LATER });
      expect(rows.get(HASHED)?.expires).toEqual(LATER);
      expect(updated).toEqual({ sessionToken: RAW, userId: USER.id, expires: LATER });
    });

    it("rewrites a legacy plaintext row to the hash, then updates it", async () => {
      seed(RAW);

      const updated = await adapter.updateSession({ sessionToken: RAW, expires: LATER });

      expect([...rows.keys()]).toEqual([HASHED]);
      expect(rows.get(HASHED)?.expires).toEqual(LATER);
      expect(updated).toEqual({ sessionToken: RAW, userId: USER.id, expires: LATER });
    });

    it("fails like the base adapter when there is no session", async () => {
      await expect(adapter.updateSession({ sessionToken: RAW, expires: LATER })).rejects.toThrow(
        "Record to update not found.",
      );
    });

    it("passes through a null result", async () => {
      const wrapped = withHashedSessionTokens({ ...base, updateSession: vi.fn(async () => null) } as Adapter);
      expect(await wrapped.updateSession!({ sessionToken: RAW })).toBeNull();
    });
  });

  describe("deleteSession", () => {
    it("deletes a hashed row", async () => {
      seed(HASHED);

      const deleted = await adapter.deleteSession(RAW);

      expect(base.deleteSession).toHaveBeenCalledWith(HASHED);
      expect(rows.size).toBe(0);
      expect(deleted).toEqual({ sessionToken: RAW, userId: USER.id, expires: EXPIRES });
    });

    it("deletes a legacy plaintext row", async () => {
      seed(RAW);

      await adapter.deleteSession(RAW);

      expect(rows.size).toBe(0);
      expect(base.deleteSession).toHaveBeenCalledWith(HASHED);
    });

    it("fails like the base adapter when there is no session", async () => {
      await expect(adapter.deleteSession(RAW)).rejects.toThrow("Record to update not found.");
    });

    it("passes through a void result", async () => {
      const wrapped = withHashedSessionTokens({ ...base, deleteSession: vi.fn(async () => undefined) } as Adapter);
      expect(await wrapped.deleteSession!(RAW)).toBeUndefined();
    });
  });
});

async function sha256(value: string): Promise<string> {
  return createHash("sha256").update(value).digest("hex");
}
