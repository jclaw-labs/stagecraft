/**
 * The Puck-shaped page (`{ content, root: { props } }`) the page editor
 * edits, and the helpers that turn it into pages-collection item values.
 *
 * Client-safe: the Pages panel and the page editor build the values
 * they send to `/api/collections/pages/items/...` with these, so this
 * module must not pull in the filesystem store or `node:crypto`.
 */

import type { Data } from "@puckeditor/core";

import type { BlockProps } from "@/puck/config";

import { PAGES_FIELD_IDS } from "./collections/field-ids";
import { pageDataToItemValues } from "./collections/migrate-from-legacy-values";
import type { Item } from "./collections/schema";

export type PageData = Data<BlockProps>;

/** Starter content for a new page: one H1 carrying the title. */
export function emptyPageData(title: string): PageData {
  return {
    content: [
      {
        type: "Heading",
        props: {
          id: `heading-${Date.now()}`,
          text: title,
          level: "h1",
          textAlign: "start",
        },
      },
    ],
    root: { props: { title, isSplashPage: false, isFooterHidden: false } },
  } as PageData;
}

/**
 * Item values for saving `data` from the page editor over the page's
 * current values. The editor owns the title, splash / footer flags and
 * body; everything else on the item (nav visibility from the Pages
 * panel, any field the artist added to the pages schema) is kept as is.
 */
export function pageValuesForSave(
  data: PageData,
  currentValues: Item["values"],
): Item["values"] {
  const showInNav = currentValues[PAGES_FIELD_IDS.showInNav];
  return {
    ...currentValues,
    ...pageDataToItemValues(data, {
      showInNav: showInNav?.type === "boolean" ? showInNav.value : true,
    }),
  };
}
