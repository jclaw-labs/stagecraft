/**
 * Admin routes that branch on first-run state must be rendered per
 * request. Left static, `next build` bakes in whichever redirect the
 * build-time content produced, so a fresh or reset site never reaches
 * the welcome wizard.
 */

import { describe, expect, it } from "vitest";

import * as adminRoot from "./page";
import * as welcome from "./welcome/page";

describe("admin route config", () => {
  it.each([
    ["/admin", adminRoot],
    ["/admin/welcome", welcome],
  ])("%s is force-dynamic", (_route, mod) => {
    expect(mod.dynamic).toBe("force-dynamic");
  });
});
