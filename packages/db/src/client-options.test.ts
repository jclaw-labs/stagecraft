import { PrismaNeon } from "@prisma/adapter-neon";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hasGlobalWebSocket, prismaClientOptions } from "./client-options";

const NEON_URL =
  "postgresql://app:secret@ep-cool-name-123456-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require";
const LOCAL_URL = "postgresql://stagecraft:stagecraft@localhost:5432/stagecraft";

describe("prismaClientOptions", () => {
  it("uses the Neon adapter when DATABASE_DRIVER=neon", () => {
    const options = prismaClientOptions(
      { DATABASE_URL: NEON_URL, DATABASE_DRIVER: "neon" },
      true,
    );
    expect(options.adapter).toBeInstanceOf(PrismaNeon);
  });

  it("passes DATABASE_URL to the Neon adapter", () => {
    const options = prismaClientOptions(
      { DATABASE_URL: NEON_URL, DATABASE_DRIVER: "neon" },
      true,
    );
    // PrismaNeon keeps its constructor argument on `config` (private in the
    // .d.ts, readable at runtime). If that field is renamed this fails loudly
    // rather than passing silently.
    expect(options.adapter).toMatchObject({ config: { connectionString: NEON_URL } });
  });

  it("uses no adapter for a Neon URL when DATABASE_DRIVER is unset", () => {
    const options = prismaClientOptions({ DATABASE_URL: NEON_URL }, true);
    expect(options).not.toHaveProperty("adapter");
  });

  it("uses no adapter for local Postgres or DATABASE_DRIVER=engine", () => {
    expect(prismaClientOptions({ DATABASE_URL: LOCAL_URL }, true)).not.toHaveProperty("adapter");
    expect(
      prismaClientOptions({ DATABASE_URL: NEON_URL, DATABASE_DRIVER: "engine" }, true),
    ).not.toHaveProperty("adapter");
  });

  it("throws when DATABASE_DRIVER=neon has no WebSocket", () => {
    expect(() =>
      prismaClientOptions({ DATABASE_URL: NEON_URL, DATABASE_DRIVER: "neon" }, false),
    ).toThrow(/needs a global WebSocket/);
  });

  it("logs queries in development and only errors otherwise", () => {
    expect(prismaClientOptions({ NODE_ENV: "development" }, true).log).toEqual([
      "query",
      "error",
      "warn",
    ]);
    expect(prismaClientOptions({ NODE_ENV: "production" }, true).log).toEqual(["error"]);
    expect(prismaClientOptions({}, true).log).toEqual(["error"]);
  });
});

describe("hasGlobalWebSocket", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is true when the runtime defines WebSocket", () => {
    vi.stubGlobal("WebSocket", class {});
    expect(hasGlobalWebSocket()).toBe(true);
  });

  it("is false when the runtime has no WebSocket", () => {
    vi.stubGlobal("WebSocket", undefined);
    expect(hasGlobalWebSocket()).toBe(false);
  });
});
