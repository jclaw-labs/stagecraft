/**
 * Admin 404s render in the admin's own look, not inside the public
 * layout's artist theme.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import AdminNotFound from "./not-found";

describe("admin not-found", () => {
  it("renders the admin 404 outside the public theme", () => {
    const html = renderToStaticMarkup(<AdminNotFound />);
    expect(html).toContain("data-admin-not-found");
    expect(html).toContain("Page not found");
    expect(html).not.toContain("stagecraft-site");
    expect(html).not.toContain("--color-background:");
  });

  it("links back into the admin", () => {
    const html = renderToStaticMarkup(<AdminNotFound />);
    expect(html).toContain('href="/admin/pages"');
  });

  it("styles the body with tokens only, no raw colours or sizes", () => {
    const html = renderToStaticMarkup(<AdminNotFound />);
    expect(html).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(html).not.toMatch(/\d(px|rem|em)\b/);
  });
});
