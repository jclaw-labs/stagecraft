// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { PageData } from "@/lib/page-data";
import { DEFAULT_APPEARANCE } from "@/lib/site-config-types";

// Stub Puck: the save handler is what's under test, not Puck's UI. The
// stub renders the editor's header actions (where the save-state pill
// lives), the drawer override (as a component, the way Puck does) and a
// button that calls `onPublish` with the editor's data, the way Puck's
// own "Publish" header button does. It also records the overrides from
// each render.
type StubOverrides = {
  headerActions?: (p: { children: unknown }) => unknown;
  iframe?: unknown;
  drawer?: React.ComponentType<{ children: React.ReactNode }>;
  drawerItem?: unknown;
};
const renderedOverrides = vi.hoisted(() => [] as StubOverrides[]);
vi.mock("@puckeditor/core", () => ({
  Puck: ({
    data,
    onPublish,
    overrides = {},
  }: {
    data: unknown;
    onPublish: (data: unknown) => void;
    overrides?: StubOverrides;
  }) => {
    renderedOverrides.push(overrides);
    const Drawer = overrides.drawer;
    return (
      <div>
        <button type="button" onClick={() => onPublish(data)}>
          Publish
        </button>
        {overrides.headerActions?.({ children: null }) as React.ReactNode}
        {Drawer ? <Drawer>{null}</Drawer> : null}
      </div>
    );
  },
  createUsePuck:
    () =>
    <T,>(selector: (state: { dispatch: () => void; selectedItem: null }) => T) =>
      selector({ dispatch: () => {}, selectedItem: null }),
}));
vi.mock("@puckeditor/core/puck.css", () => ({}));

import { PAGES_FIELD_IDS } from "@/lib/collections/field-ids";
import type { Item } from "@/lib/collections/schema";

import { Editor } from "./Editor";

const ITEM_URL = "/api/collections/pages/items/about";

const EDITOR_DATA = {
  content: [
    { type: "Heading", props: { id: "h1", text: "About", level: "h1", textAlign: "start" } },
  ],
  root: { props: { title: "About us", isSplashPage: false, isFooterHidden: false } },
} as unknown as PageData;

// The page as the store has it at save time: hidden from the nav (set
// from the Pages panel) and carrying a field the editor doesn't own.
const CURRENT_VALUES: Item["values"] = {
  [PAGES_FIELD_IDS.title]: { type: "text", value: "About" },
  [PAGES_FIELD_IDS.isSplashPage]: { type: "boolean", value: false },
  [PAGES_FIELD_IDS.isFooterHidden]: { type: "boolean", value: false },
  [PAGES_FIELD_IDS.showInNav]: { type: "boolean", value: false },
  [PAGES_FIELD_IDS.body]: { type: "puckContent", value: { content: [], root: { props: {} } } },
  f_custom: { type: "text", value: "kept" },
};

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  renderedOverrides.length = 0;
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderEditor() {
  render(
    <Editor
      initialData={EDITOR_DATA}
      pageSlug="about"
      email="a@b.c"
      embeddableCollections={[]}
      appearance={DEFAULT_APPEARANCE}
    />,
  );
}

async function save() {
  fireEvent.click(screen.getByRole("button", { name: "Publish" }));
}

describe("<Editor> save", () => {
  it("reads the current item, then PUTs the editor data merged over its values", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { ok: true, item: { values: CURRENT_VALUES } }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true, item: {} }));
    renderEditor();
    await save();

    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Saved"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [getUrl, getInit] = fetchMock.mock.calls[0];
    expect(getUrl).toBe(ITEM_URL);
    expect(getInit?.method ?? "GET").toBe("GET");

    const [putUrl, putInit] = fetchMock.mock.calls[1];
    expect(putUrl).toBe(ITEM_URL);
    expect(putInit.method).toBe("PUT");
    const { values } = JSON.parse(putInit.body as string) as { values: Item["values"] };
    // Nav visibility comes from the GET, not a default.
    expect(values[PAGES_FIELD_IDS.showInNav], "nav visibility from GET").toEqual({
      type: "boolean",
      value: false,
    });
    expect(values.f_custom, "field the editor doesn't own").toEqual({ type: "text", value: "kept" });
    expect(values[PAGES_FIELD_IDS.title], "title from editor data").toEqual({
      type: "text",
      value: "About us",
    });
  });

  it("surfaces the GET's error and sends no PUT when the page is gone", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(404, { ok: false, error: "Item not found" }));
    renderEditor();
    await save();

    const alert = await screen.findByRole("alert");
    expect(alert.getAttribute("title")).toBe("Item not found");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces the PUT's error when the save is refused", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { ok: true, item: { values: CURRENT_VALUES } }))
      .mockResolvedValueOnce(
        jsonResponse(409, { ok: false, error: "Save failed: draft branch moved" }),
      );
    renderEditor();
    await save();

    const alert = await screen.findByRole("alert");
    expect(alert.getAttribute("title")).toBe("Save failed: draft branch moved");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("names the failing field when the save is rejected", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(200, {
          ok: true,
          item: { values: CURRENT_VALUES },
          def: { fields: [{ id: PAGES_FIELD_IDS.title, key: "title" }] },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(400, {
          ok: false,
          error: "Validation failed",
          issues: [{ path: `values.${PAGES_FIELD_IDS.title}`, message: "Required" }],
        }),
      );
    renderEditor();
    await save();

    const alert = await screen.findByRole("alert");
    expect(alert.getAttribute("title")).toBe("Validation failed: title: Required");
  });

  it("falls back to a Save failed message with the HTTP status", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { ok: true, item: { values: CURRENT_VALUES } }))
      .mockResolvedValueOnce(jsonResponse(500, null));
    renderEditor();
    await save();

    const alert = await screen.findByRole("alert");
    expect(alert.getAttribute("title")).toBe("Save failed (HTTP 500)");
  });

  it("shows the error state when the request throws", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    renderEditor();
    await save();

    const alert = await screen.findByRole("alert");
    expect(alert.getAttribute("title")).toBe("offline");
    expect(screen.queryByText("Saved")).toBeNull();
  });
});

describe("<Editor> overrides", () => {
  // Puck renders the `iframe`, `drawer` and `drawerItem` overrides as
  // component types, so a new function on each render would remount
  // them: every block in the canvas, or the whole drawer.
  it("keeps the iframe override's identity when the editor re-renders", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { ok: true, item: { values: CURRENT_VALUES } }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true, item: {} }));
    renderEditor();
    await save();
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Saved"));

    const iframes = renderedOverrides.map((o) => o.iframe);
    expect(iframes.length, "renders").toBeGreaterThan(1);
    expect(typeof iframes[0]).toBe("function");
    expect(new Set(iframes).size).toBe(1);
  });

  it("keeps the drawer mounted while the artist types a filter", () => {
    renderEditor();
    const input = screen.getByRole("searchbox", { name: "Filter blocks" });
    input.focus();

    fireEvent.change(input, { target: { value: "q" } });
    fireEvent.change(input, { target: { value: "qu" } });

    expect(renderedOverrides.length, "renders").toBeGreaterThan(2);
    expect(new Set(renderedOverrides.map((o) => o.drawer)).size).toBe(1);
    expect(new Set(renderedOverrides.map((o) => o.drawerItem)).size).toBe(1);
    // The same input, still focused: a remount would have replaced it.
    expect(screen.getByRole("searchbox", { name: "Filter blocks" })).toBe(input);
    expect(document.activeElement).toBe(input);
    expect((input as HTMLInputElement).value).toBe("qu");
  });
});
