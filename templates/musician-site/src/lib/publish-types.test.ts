/**
 * Coverage for the small bits of logic in publish-types.ts. The Zod
 * schemas are exercised indirectly by the route tests; this file just
 * locks the `publishErrorHttpStatus` mapping so a future contributor
 * doesn't quietly change `concurrent-edit` away from 409 (the value
 * the editor's "someone else just saved" UX is keyed off of).
 */

import { describe, expect, it } from "vitest";

import {
  PUBLISH_WARNING_MESSAGES,
  publishErrorHttpStatus,
  publishWarningSchema,
} from "./publish-types";

describe("publishErrorHttpStatus", () => {
  it("maps concurrent-edit to 409 (recoverable client-side)", () => {
    expect(publishErrorHttpStatus("concurrent-edit")).toBe(409);
  });

  it("maps broker-rejected to 502 (upstream failure)", () => {
    expect(publishErrorHttpStatus("broker-rejected")).toBe(502);
  });

  it.each([
    "unauthorized",
    "broker-unreachable",
    "github-failed",
    "validation-failed",
    "no-platform-configured",
  ] as const)("maps %s to 500", (code) => {
    expect(publishErrorHttpStatus(code)).toBe(500);
  });
});

describe("publish warnings", () => {
  it.each(publishWarningSchema.options)("has editor copy for %s", (warning) => {
    expect(PUBLISH_WARNING_MESSAGES[warning]).toMatch(/\S/);
  });

  it("rejects an unknown warning code", () => {
    expect(publishWarningSchema.safeParse("draft-resync-later").success).toBe(false);
  });
});
