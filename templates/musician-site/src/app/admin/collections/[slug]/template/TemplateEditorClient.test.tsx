import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// Mock Puck so the editor doesn't try to mount its full UI under SSR —
// the assertions here are about chrome + preview wiring, not the
// internals of `<Puck>` itself. The stub renders a marker we can
// inspect and exposes the `overrides.headerActions` content (which
// contains our dropdown).
vi.mock("@measured/puck", () => ({
  Puck: ({ overrides }: { overrides?: { headerActions?: (p: { children: unknown }) => unknown } }) => {
    const header = overrides?.headerActions?.({ children: null });
    return (
      <div data-testid="puck-mock">
        <div data-testid="puck-header">{header as React.ReactNode}</div>
      </div>
    );
  },
  Render: ({ data }: { data: unknown }) => (
    <div data-testid="puck-render-mock">{JSON.stringify(data)}</div>
  ),
}));

// Spy on resolveTemplate so we can assert it received the right item.
const resolveTemplateMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/collections/template/renderer", async () => {
  const actual = await vi.importActual<typeof import("@/lib/collections/template/renderer")>(
    "@/lib/collections/template/renderer",
  );
  return { ...actual, resolveTemplate: resolveTemplateMock };
});

import { TemplateEditorClient } from "./TemplateEditorClient";
import { FIXTURE_TIMESTAMP, tourDatesDef } from "@/lib/collections/test-fixtures";
import type { Item } from "@/lib/collections";

function parisItem(): Item {
  return {
    id: "item_paris-2026",
    slug: "paris-2026",
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
    values: {
      f_date: { type: "date", value: "2026-07-15" },
      f_venue: { type: "text", value: "La Cigale" },
      f_city: { type: "text", value: "Paris" },
      f_status: { type: "select", value: "on_sale" },
      f_url: { type: "url", value: "https://tix.example/paris" },
    },
  };
}

function tokyoItem(): Item {
  return {
    id: "item_tokyo-2026",
    slug: "tokyo-2026",
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
    values: {
      f_date: { type: "date", value: "2026-08-20" },
      f_venue: { type: "text", value: "Liquidroom" },
      f_city: { type: "text", value: "Tokyo" },
      f_status: { type: "select", value: "on_sale" },
      f_url: { type: "url", value: "https://tix.example/tokyo" },
    },
  };
}

function render(props: Partial<Parameters<typeof TemplateEditorClient>[0]> = {}): string {
  resolveTemplateMock.mockClear();
  // Default to returning a minimal resolved tree so the preview pane
  // has something to hand to `<Render>`.
  resolveTemplateMock.mockReturnValue({ content: [], root: { props: {} } });
  return renderToStaticMarkup(
    <TemplateEditorClient
      collectionSlug="tour-dates"
      def={tourDatesDef()}
      kind="item"
      email="dev@example.com"
      previewItems={[parisItem(), tokyoItem()]}
      {...props}
    />,
  );
}

describe("<TemplateEditorClient />", () => {
  describe("chrome", () => {
    it("renders the preview-item dropdown with each item's slug as an option", () => {
      const html = render();
      expect(html).toContain('aria-label="Preview item"');
      expect(html).toContain(">paris-2026<");
      expect(html).toContain(">tokyo-2026<");
    });

    it("defaults the dropdown to the first item", () => {
      const html = render();
      // The selected value lives in `<select value=…>`; renderToStaticMarkup
      // serialises `selected` on the matching `<option>`.
      const match = html.match(/<option[^>]*selected[^>]*>([^<]+)</);
      expect(match?.[1]).toBe("paris-2026");
    });

    it("falls back to a 'No items' label when the collection is empty", () => {
      const html = render({ previewItems: [] });
      expect(html).toContain("No items");
      expect(html).not.toContain('aria-label="Preview item"');
    });
  });

  describe("preview pane", () => {
    it("invokes resolveTemplate with the default-selected item", () => {
      render();
      expect(resolveTemplateMock).toHaveBeenCalled();
      const [, item, options] = resolveTemplateMock.mock.calls[0];
      expect(item.slug).toBe("paris-2026");
      expect(options?.currentItem?.slug).toBe("paris-2026");
    });

    it("passes the primitive-only registry for item-kind editors", () => {
      render({ kind: "item" });
      const [, , options] = resolveTemplateMock.mock.calls[0];
      // The PR's item template uses just primitives — no Collection
      // entries. Section/Text/Image/Button/Link/Stack/RichTextRender.
      const keys = Object.keys(options?.registry ?? {}).sort();
      expect(keys).toContain("Text");
      expect(keys).toContain("Image");
      // Detail-only Collection blocks (e.g. TourDatesView) must NOT
      // appear in the item-template preview registry.
      expect(keys.some((k) => k.endsWith("View"))).toBe(false);
    });

    it("extends the registry with Collection blocks for detail-kind editors", () => {
      const tdDef = tourDatesDef();
      const pagesDef = { ...tdDef, slug: "pages" };
      render({
        kind: "detail",
        iterableCollectionDefs: [tdDef, pagesDef],
        loadedCollections: {
          "tour-dates": { def: tdDef, items: [parisItem()] },
        },
      });
      const [, , options] = resolveTemplateMock.mock.calls[0];
      const keys = Object.keys(options?.registry ?? {});
      expect(keys).toContain("TourDatesView");
      expect(keys).toContain("PagesView");
      expect(options?.loadedCollections).toBeDefined();
    });

    it("renders the empty-state when the collection has no items", () => {
      const html = render({ previewItems: [] });
      expect(html).toMatch(/Add an item to enable preview/);
      // The Puck mock's render is mounted, but the resolved-tree
      // marker must NOT be — there's nothing to render against.
      expect(html).not.toContain("template-preview-render");
    });

    it("renders the resolved tree marker when an item is selected", () => {
      const html = render();
      expect(html).toContain("template-preview-render");
    });
  });
});
