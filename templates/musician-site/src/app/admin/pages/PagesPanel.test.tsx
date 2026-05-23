import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// `useRouter` reads from a React context the App Router mounts at runtime.
// Stub it for static render-only tests so the component doesn't blow up.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { type PageSummary } from "@/lib/site-config-types";

import { PagesPanel } from "./PagesPanel";

const SUMMARIES: PageSummary[] = [
  { slug: "home", title: "Home", isSplashPage: false, isHiddenFromNav: false },
  { slug: "about", title: "About", isSplashPage: false, isHiddenFromNav: true },
  { slug: "splash", title: "Splash", isSplashPage: true, isHiddenFromNav: false },
];

function render(): string {
  return renderToStaticMarkup(<PagesPanel initialPages={SUMMARIES} />);
}

describe("<PagesPanel> static markup", () => {
  it("renders one draggable row per page with a drag handle", () => {
    const html = render();
    // One row per slug, marked draggable for HTML5 drag-and-drop.
    expect((html.match(/draggable="true"/g) ?? []).length).toBe(SUMMARIES.length);
    // Drag handle marker is present (visual affordance).
    expect((html.match(/⋮⋮/g) ?? []).length).toBe(SUMMARIES.length);
  });

  it("renders an Edit link per row pointing at the Puck editor route", () => {
    const html = render();
    expect(html).toContain('href="/admin/pages/home"');
    expect(html).toContain('href="/admin/pages/about"');
    // Each row has its own Edit button.
    expect((html.match(/>Edit</g) ?? []).length).toBe(SUMMARIES.length);
  });

  it("shows an eye toggle for non-splash pages, marked pressed when hidden", () => {
    const html = render();
    // about is hidden → eye-off pressed
    expect(html).toMatch(
      /aria-label="Show About in the navigation menu"[^>]*aria-pressed="true"/,
    );
    // home is visible → eye-on not-pressed
    expect(html).toMatch(
      /aria-label="Hide Home from the navigation menu"[^>]*aria-pressed="false"/,
    );
  });

  it("does NOT render an eye toggle for splash pages", () => {
    const html = render();
    expect(html).not.toMatch(/aria-label="[^"]*Splash[^"]*navigation menu"/);
    // Splash chip is rendered instead.
    expect(html).toContain(">Splash<");
  });

  it("does not embed any 'Pages in the nav' / ReorderableList markup", () => {
    // The nav-items picker moved out of the Header & Navigation panel and
    // into the Pages list itself — guard against accidentally restoring it
    // by checking the legacy section title doesn't reappear here.
    const html = render();
    expect(html).not.toContain("Pages in the nav");
    expect(html).not.toContain("Add a page to the nav");
  });

  it("does NOT auto-navigate after creating a page (no client-side push hint)", () => {
    // The static markup is just a sanity guard — the meaningful assertion
    // for "stays on the Pages list after create" lives in the handler logic
    // (no `router.push` call in `handleCreate`). Here we just ensure the
    // current submit button label is the simple "Add page" with no implicit
    // "and edit" affordance baked into the markup.
    const html = render();
    expect(html).toContain(">Add page<");
    expect(html).not.toContain(">Add and edit<");
  });
});
