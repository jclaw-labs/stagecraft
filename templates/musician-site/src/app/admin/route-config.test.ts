/**
 * Admin pages branch on first-run state and the session, so they must be
 * rendered per request. Left static, `next build` bakes in whichever
 * redirect the build-time content produced, so a fresh or reset site
 * never reaches the welcome wizard. Every admin page is served by the one
 * catch-all route, which carries the config.
 */

import { describe, expect, it } from "vitest";

import * as adminCatchAll from "./[[...path]]/page.js";

describe("admin route config", () => {
  it("the admin catch-all is force-dynamic", () => {
    expect(adminCatchAll.dynamic).toBe("force-dynamic");
  });
});
