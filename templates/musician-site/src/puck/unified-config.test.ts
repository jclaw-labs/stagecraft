import { describe, expect, it } from "vitest";

import { puckConfig } from "./config";
import { buildUnifiedPublicConfig } from "./unified-config";

describe("buildUnifiedPublicConfig", () => {
  const config = buildUnifiedPublicConfig(["tour-dates", "releases", "posts"]);
  const c = config.components as Record<string, { render?: unknown } | undefined>;
  const pc = puckConfig.components as Record<string, { render?: unknown }>;

  it("keeps the page chrome blocks with their own render (primitives don't override)", () => {
    expect(c.Section).toBeDefined();
    expect(c.Heading).toBeDefined();
    expect(c.Button).toBeDefined();
    // A same-named template primitive (Section / Button) expects Bindable props;
    // the chrome render must win, so the fn is referentially `puckConfig`'s.
    expect(c.Section?.render).toBe(pc.Section.render);
    expect(c.Button?.render).toBe(pc.Button.render);
  });

  it("registers a generic Collection block per slug (the bespoke *View blocks are gone)", () => {
    expect(c.TourDatesView).toBeDefined();
    expect(c.ReleasesView).toBeDefined();
    expect(c.PostsView).toBeDefined();
    expect(c.TourDatesView?.render).toBeTypeOf("function");
    // Post-ADR-015 PR-6, puckConfig no longer defines the bespoke `*View`
    // blocks — these names resolve solely to the generic Collection-block
    // registry layered on top.
    expect(pc.TourDatesView).toBeUndefined();
  });

  it("excludes template-only primitives (no name leak onto pages)", () => {
    // Stack / Link are template primitives with no page-chrome equivalent;
    // they must not appear in the page config.
    expect(c.Stack).toBeUndefined();
    expect(c.Link).toBeUndefined();
  });
});
