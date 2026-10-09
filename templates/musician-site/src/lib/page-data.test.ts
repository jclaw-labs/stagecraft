import { describe, expect, it } from "vitest";

import { PAGES_FIELD_IDS } from "./collections/field-ids";
import type { Item } from "./collections/schema";
import { emptyPageData, pageValuesForSave } from "./page-data";

describe("emptyPageData", () => {
  it("includes a heading and root props with the title", () => {
    const data = emptyPageData("Hello");
    expect(data.content).toHaveLength(1);
    expect(data.content[0].type).toBe("Heading");
    expect((data.content[0].props as { text: string }).text).toBe("Hello");
    expect((data.root as { props: { title: string } }).props.title).toBe("Hello");
  });

  it("defaults root flags to false", () => {
    const data = emptyPageData("Hello");
    const props = (data.root as {
      props: { isSplashPage: boolean; isFooterHidden: boolean };
    }).props;
    expect(props.isSplashPage).toBe(false);
    expect(props.isFooterHidden).toBe(false);
  });
});

describe("pageValuesForSave", () => {
  const current: Item["values"] = {
    [PAGES_FIELD_IDS.title]: { type: "text", value: "Old title" },
    [PAGES_FIELD_IDS.isSplashPage]: { type: "boolean", value: false },
    [PAGES_FIELD_IDS.isFooterHidden]: { type: "boolean", value: false },
    [PAGES_FIELD_IDS.showInNav]: { type: "boolean", value: false },
    [PAGES_FIELD_IDS.body]: {
      type: "puckContent",
      value: { content: [], root: { props: {} } },
    },
    f_custom: { type: "text", value: "kept" },
  };

  const data = {
    content: [{ type: "Heading", props: { id: "h1", text: "Hi", level: "h1", textAlign: "start" } }],
    root: { props: { title: "New title", isSplashPage: true, isFooterHidden: true } },
  } as unknown as Parameters<typeof pageValuesForSave>[0];

  it("takes title, flags and body from the editor data", () => {
    const values = pageValuesForSave(data, current);
    expect(values[PAGES_FIELD_IDS.title]).toEqual({ type: "text", value: "New title" });
    expect(values[PAGES_FIELD_IDS.isSplashPage]).toEqual({ type: "boolean", value: true });
    expect(values[PAGES_FIELD_IDS.isFooterHidden]).toEqual({ type: "boolean", value: true });
    expect(values[PAGES_FIELD_IDS.body]).toEqual({
      type: "puckContent",
      value: { content: data.content, root: { props: {} } },
    });
  });

  it("keeps the page's nav visibility", () => {
    const values = pageValuesForSave(data, current);
    expect(values[PAGES_FIELD_IDS.showInNav]).toEqual({ type: "boolean", value: false });
  });

  it("shows the page in the nav when the current item has no nav flag", () => {
    const withoutNav = { ...current };
    delete withoutNav[PAGES_FIELD_IDS.showInNav];
    const values = pageValuesForSave(data, withoutNav);
    expect(values[PAGES_FIELD_IDS.showInNav]).toEqual({ type: "boolean", value: true });
  });

  it("keeps fields the editor doesn't own", () => {
    const values = pageValuesForSave(data, current);
    expect(values.f_custom).toEqual({ type: "text", value: "kept" });
  });
});
