import { describe, expect, it } from "vitest";
import { resolveDatabaseDriver } from "./driver";

const NEON_URL =
  "postgresql://app:secret@ep-cool-name-123456-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require";
const LOCAL_URL = "postgresql://stagecraft:stagecraft@localhost:5432/stagecraft";

describe("resolveDatabaseDriver", () => {
  it("keeps the engine for a Neon URL when DATABASE_DRIVER is unset", () => {
    expect(
      resolveDatabaseDriver({ databaseUrl: NEON_URL, override: undefined, hasWebSocket: true }),
    ).toBe("engine");
  });

  it("keeps the engine for local Postgres and for a missing URL", () => {
    expect(
      resolveDatabaseDriver({ databaseUrl: LOCAL_URL, override: undefined, hasWebSocket: true }),
    ).toBe("engine");
    expect(
      resolveDatabaseDriver({ databaseUrl: undefined, override: undefined, hasWebSocket: false }),
    ).toBe("engine");
  });

  it("treats an empty override as unset", () => {
    expect(
      resolveDatabaseDriver({ databaseUrl: NEON_URL, override: "", hasWebSocket: true }),
    ).toBe("engine");
    expect(
      resolveDatabaseDriver({ databaseUrl: NEON_URL, override: "  ", hasWebSocket: true }),
    ).toBe("engine");
  });

  it("accepts an explicit DATABASE_DRIVER=engine", () => {
    expect(
      resolveDatabaseDriver({ databaseUrl: NEON_URL, override: "engine", hasWebSocket: true }),
    ).toBe("engine");
  });

  it("lets DATABASE_DRIVER=neon opt in to the adapter, case- and space-insensitively", () => {
    expect(
      resolveDatabaseDriver({ databaseUrl: NEON_URL, override: "neon", hasWebSocket: true }),
    ).toBe("neon");
    expect(
      resolveDatabaseDriver({ databaseUrl: LOCAL_URL, override: " Neon ", hasWebSocket: true }),
    ).toBe("neon");
  });

  it("rejects an unknown override", () => {
    expect(() =>
      resolveDatabaseDriver({ databaseUrl: NEON_URL, override: "pg", hasWebSocket: true }),
    ).toThrow(/DATABASE_DRIVER must be one of neon, engine; got "pg"/);
  });

  it("rejects a forced Neon adapter without a URL", () => {
    expect(() =>
      resolveDatabaseDriver({ databaseUrl: undefined, override: "neon", hasWebSocket: true }),
    ).toThrow(/needs DATABASE_URL/);
    expect(() =>
      resolveDatabaseDriver({ databaseUrl: "", override: "neon", hasWebSocket: true }),
    ).toThrow(/needs DATABASE_URL/);
  });

  it("rejects a forced Neon adapter without WebSocket", () => {
    expect(() =>
      resolveDatabaseDriver({ databaseUrl: NEON_URL, override: "neon", hasWebSocket: false }),
    ).toThrow(/needs a global WebSocket/);
  });
});
