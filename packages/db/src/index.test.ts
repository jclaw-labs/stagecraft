import { PrismaNeon } from "@prisma/adapter-neon";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Capture what `index.ts` hands the PrismaClient constructor, without opening
// a connection.
const constructed = vi.hoisted(() => [] as unknown[]);

vi.mock("@prisma/client", () => ({
  PrismaClient: class {
    constructor(options: unknown) {
      constructed.push(options);
    }
  },
}));

const NEON_URL =
  "postgresql://app:secret@ep-cool-name-123456-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require";

async function loadClientOptions(): Promise<{ adapter?: unknown }> {
  vi.resetModules();
  delete (globalThis as { prisma?: unknown }).prisma;
  constructed.length = 0;
  await import("./index");
  expect(constructed).toHaveLength(1);
  return constructed[0] as { adapter?: unknown };
}

describe("prisma singleton", () => {
  beforeEach(() => {
    vi.stubGlobal("WebSocket", class {});
    vi.stubEnv("DATABASE_URL", NEON_URL);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    delete (globalThis as { prisma?: unknown }).prisma;
  });

  it("is built on the Neon adapter when DATABASE_DRIVER=neon", async () => {
    vi.stubEnv("DATABASE_DRIVER", "neon");
    expect((await loadClientOptions()).adapter).toBeInstanceOf(PrismaNeon);
  });

  it("is built on the TCP engine when DATABASE_DRIVER is unset", async () => {
    vi.stubEnv("DATABASE_DRIVER", "");
    expect(await loadClientOptions()).not.toHaveProperty("adapter");
  });

  it("fails at import when DATABASE_DRIVER=neon has no WebSocket", async () => {
    vi.stubEnv("DATABASE_DRIVER", "neon");
    vi.stubGlobal("WebSocket", undefined);
    await expect(loadClientOptions()).rejects.toThrow(/needs a global WebSocket/);
  });
});
