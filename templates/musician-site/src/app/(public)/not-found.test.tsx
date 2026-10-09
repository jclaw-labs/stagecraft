/**
 * The public 404 body. The theme comes from whichever layout wraps it
 * (the `(public)` group layout, or `global-not-found.tsx`); this pins
 * the body's own markup and styling.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import PublicNotFound from "./not-found";

function renderMain(): string {
  return renderToStaticMarkup(<PublicNotFound />);
}

describe("public not-found body", () => {
  it("renders the 404 message and a link home", () => {
    const html = renderMain();
    expect(html).toContain("<h1");
    expect(html).toContain("404");
    expect(html).toContain("This page could not be found.");
    expect(html).toContain('href="/"');
  });

  it("renders its own body, not Next's internal 404 UI", () => {
    const source = readFileSync(path.join(import.meta.dirname, "not-found.tsx"), "utf-8");
    expect(source).not.toMatch(/from\s+["']next\/dist\//);
  });

  it("styles the body with tokens only, no raw colours or sizes", () => {
    const html = renderMain();
    expect(html).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(html).not.toMatch(/\d(px|rem|em)\b/);
  });

  // Server rendering can't measure layout, so this pins the declarations,
  // not the rendered height.
  it("declares a border-box main at least one viewport tall", () => {
    const html = renderMain();
    const main = html.slice(html.indexOf("<main"), html.indexOf(">", html.indexOf("<main")));
    expect(main).toContain("box-sizing:border-box");
    expect(main).toMatch(/min-height:100vh(;|")/);
  });
});
