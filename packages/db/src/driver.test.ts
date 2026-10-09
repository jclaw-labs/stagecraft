import { describe, expect, it } from "vitest";
import { isNeonUrl, resolveDatabaseDriver } from "./driver";

const NEON_URL =
  "postgresql://app:secret@ep-cool-name-123456-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require";
const LOCAL_URL = "postgresql://stagecraft:stagecraft@localhost:5432/stagecraft";

describe("isNeonUrl", () => {
  it("recognises Neon hosts, pooled or direct", () => {
    expect(isNeonUrl(NEON_URL)).toBe(true);
    expect(isNeonUrl("postgres://u:p@ep-x.eu-central-1.aws.NEON.TECH/db")).toBe(true);
  });

  it("rejects other hosts", () => {
    expect(isNeonUrl(LOCAL_URL)).toBe(false);
    expect(isNeonUrl("postgresql://u:p@db.notneon.tech/db")).toBe(false);
    expect(isNeonUrl("postgresql://u:p@neon.tech.example.com/db")).toBe(false);
  });

  it("treats missing or unparseable URLs as not Neon", () => {
    expect(isNeonUrl(undefined)).toBe(false);
    expect(isNeonUrl("")).toBe(false);
    expect(isNeonUrl("not a url")).toBe(false);
  });
});

describe("resolveDatabaseDriver", () => {
  it("uses the Neon adapter for a Neon URL when WebSocket is available", () => {
    expect(
      resolveDatabaseDriver({ databaseUrl: NEON_URL, override: undefined, hasWebSocket: true }),
    ).toBe("neon");
  });

  it("keeps the engine for a Neon URL without WebSocket", () => {
    expect(
      resolveDatabaseDriver({ databaseUrl: NEON_URL, override: undefined, hasWebSocket: false }),
    ).toBe("engine");
  });

  it("keeps the engine for local Postgres and for a missing URL", () => {
    expect(
      resolveDatabaseDriver({ databaseUrl: LOCAL_URL, override: undefined, hasWebSocket: true }),
    ).toBe("engine");
    expect(
      resolveDatabaseDriver({ databaseUrl: undefined, override: undefined, hasWebSocket: true }),
    ).toBe("engine");
  });

  it("treats an empty override as unset", () => {
    expect(
      resolveDatabaseDriver({ databaseUrl: NEON_URL, override: "  ", hasWebSocket: true }),
    ).toBe("neon");
  });

  it("lets DATABASE_DRIVER=engine opt a Neon URL out of the adapter", () => {
    expect(
      resolveDatabaseDriver({ databaseUrl: NEON_URL, override: "engine", hasWebSocket: true }),
    ).toBe("engine");
  });

  it("lets DATABASE_DRIVER=neon force the adapter for a non-Neon host", () => {
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
  });

  it("rejects a forced Neon adapter without WebSocket", () => {
    expect(() =>
      resolveDatabaseDriver({ databaseUrl: NEON_URL, override: "neon", hasWebSocket: false }),
    ).toThrow(/needs a global WebSocket/);
  });
});
