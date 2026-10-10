/**
 * Default detail page for a collection item whose collection has no
 * `detailTemplate` (today: posts at `/news/<slug>`, releases at
 * `/releases/<slug>`, tour dates at `/shows/<slug>`, plus any
 * artist-created collection with a `detailUrlPrefix`).
 *
 * Driven by the collection's field list rather than per-slug code, so a
 * field the artist adds through the schema editor shows up without a
 * template change. Layout, top to bottom:
 *
 *   - cover: the first image field with a value;
 *   - meta line: select labels, formatted dates and numbers, in field
 *     order ("Interview · April 2, 2026");
 *   - title: the slug-source field (falls back to the slug);
 *   - subtitle: the remaining short text fields, comma-joined
 *     ("New York, United States");
 *   - long-text fields as paragraphs, link fields as buttons;
 *   - `puckContent` / `richText` bodies through the template renderer;
 *   - any further images.
 *
 * Internal fields stay off the page: item metadata (id, timestamps),
 * and field types the card views never show a visitor — boolean,
 * color, file and collection references. Field keys are never printed.
 */

import type { CSSProperties, ReactNode } from "react";
import { Render } from "@puckeditor/core";

import { Image } from "@/components/Image";
import type { ImageMetadata } from "@/lib/image-types";
import { buildRenderConfig } from "@/puck/render-config";

import { itemDisplayLabel, selectOptionLabel } from "../accessors";
import { TOUR_DATES_FIELD_IDS } from "../field-ids";
import type { CollectionDef, FieldDef, FieldId, Item, TiptapJSON } from "../schema";
import { resolveTemplate } from "./renderer";
import { renderTiptap } from "./tiptap-render";
import type { Template } from "./types";

// ---------------------------------------------------------------------------
// Field → section classification (pure; exported for tests)
// ---------------------------------------------------------------------------

export type DetailLink = { fieldId: FieldId; href: string; label: string };

export type DetailBody =
  | { fieldId: FieldId; kind: "puckContent"; template: Template }
  | { fieldId: FieldId; kind: "richText"; doc: TiptapJSON };

export type ItemDetailSections = {
  title: string;
  cover: ImageMetadata | null;
  meta: string[];
  subtitle: string | null;
  paragraphs: string[];
  links: DetailLink[];
  bodies: DetailBody[];
  extraImages: ImageMetadata[];
};

/**
 * Link text for built-in URL fields whose hostname would read worse than
 * a call to action. Other URL fields show their hostname.
 */
const LINK_LABELS: Readonly<Record<FieldId, string>> = {
  [TOUR_DATES_FIELD_IDS.ticketUrl]: "Tickets",
};

/**
 * Split an item's values into the detail layout's sections. Fields are
 * visited in the collection's field order, so the artist's ordering in
 * the schema editor carries through to the page.
 */
export function itemDetailSections(def: CollectionDef, item: Item): ItemDetailSections {
  const title = itemDisplayLabel(def, item);
  // Skip the slug-source field below only when it supplied the title;
  // when the title fell back to the slug, the field still renders.
  const sourceValue = def.slugSourceFieldId ? item.values[def.slugSourceFieldId] : undefined;
  const titleFieldId =
    sourceValue?.type === "text" && sourceValue.value.trim() ? def.slugSourceFieldId : null;

  const sections: ItemDetailSections = {
    title,
    cover: null,
    meta: [],
    subtitle: null,
    paragraphs: [],
    links: [],
    bodies: [],
    extraImages: [],
  };
  const subtitleParts: string[] = [];

  for (const field of def.fields) {
    if (field.id === titleFieldId) continue;
    const value = item.values[field.id];
    if (value === undefined) continue;

    switch (value.type) {
      case "image":
        if (sections.cover === null) sections.cover = value.value;
        else sections.extraImages.push(value.value);
        break;
      case "select":
        pushNonEmpty(sections.meta, selectOptionLabel(field, value.value));
        break;
      case "multiSelect":
        pushNonEmpty(
          sections.meta,
          value.value.map((v) => selectOptionLabel(field, v)).join(", "),
        );
        break;
      case "date":
        pushNonEmpty(sections.meta, formatDetailDate(value.value, includesTime(field)));
        break;
      case "number":
        sections.meta.push(value.value.toLocaleString("en-US"));
        break;
      case "text":
        pushNonEmpty(subtitleParts, value.value.trim());
        break;
      case "longText":
        pushNonEmpty(sections.paragraphs, value.value.trim());
        break;
      case "url":
        if (value.value.trim()) {
          sections.links.push({
            fieldId: field.id,
            href: value.value,
            label: LINK_LABELS[field.id] ?? hostnameOf(value.value),
          });
        }
        break;
      case "email":
        if (value.value.trim()) {
          sections.links.push({
            fieldId: field.id,
            href: `mailto:${value.value}`,
            label: value.value,
          });
        }
        break;
      case "puckContent": {
        const template = value.value as Template;
        if (Array.isArray(template.content) && template.content.length > 0) {
          sections.bodies.push({ fieldId: field.id, kind: "puckContent", template });
        }
        break;
      }
      case "richText":
        if (Array.isArray(value.value.content) && value.value.content.length > 0) {
          sections.bodies.push({ fieldId: field.id, kind: "richText", doc: value.value });
        }
        break;
      // Internal: boolean / color / file / collectionRef /
      // multiCollectionRef never reach a visitor.
      default:
        break;
    }
  }

  sections.subtitle = subtitleParts.length > 0 ? subtitleParts.join(", ") : null;
  return sections;
}

function pushNonEmpty(out: string[], value: string): void {
  if (value) out.push(value);
}

function includesTime(field: FieldDef): boolean {
  return field.type === "date" && field.includeTime === true;
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * Format a stored date for the detail page, in UTC (the template's date
 * convention): "April 2, 2026", or with `includeTime`
 * "Tue, August 25, 2026 · 8:00 PM". A naked local datetime
 * (`2026-07-15T20:00`, how tour dates store venue-local time) is shown
 * as written rather than shifted by the server's time zone. An
 * unparseable value comes back unchanged.
 */
export function formatDetailDate(raw: string, includeTime: boolean): string {
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw);
  const ms = Date.parse(raw.includes("T") && !hasZone ? `${raw}Z` : raw);
  if (Number.isNaN(ms)) return raw;
  const d = new Date(ms);
  const date = d.toLocaleDateString("en-US", {
    weekday: includeTime ? "short" : undefined,
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  if (!includeTime) return date;
  const time = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  });
  return `${date} · ${time}`;
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

/**
 * The default detail body for one item. Server-rendered; the catch-all
 * route wraps it in the public header / footer chrome.
 */
export function DefaultItemDetail({
  def,
  item,
}: {
  def: CollectionDef;
  item: Item;
}): ReactNode {
  const s = itemDetailSections(def, item);
  return (
    <article data-item-detail={def.slug} style={articleStyle}>
      {s.cover ? (
        <div data-item-detail-cover style={coverStyle(s.cover)}>
          <Image image={s.cover} sizes="(max-width: 768px) 100vw, 768px" isPriority />
        </div>
      ) : null}
      <header style={headerStyle}>
        {s.meta.length > 0 ? <p style={metaStyle}>{s.meta.join(" · ")}</p> : null}
        <h1 style={titleStyle}>{s.title}</h1>
        {s.subtitle ? <p style={subtitleStyle}>{s.subtitle}</p> : null}
      </header>
      {s.paragraphs.map((text, i) => (
        <p key={i} style={paragraphStyle}>
          {text}
        </p>
      ))}
      {s.links.length > 0 ? (
        <p style={linksStyle}>
          {s.links.map((link) => (
            <a
              key={link.fieldId}
              href={link.href}
              rel="noopener noreferrer"
              style={linkButtonStyle}
            >
              {link.label}
            </a>
          ))}
        </p>
      ) : null}
      {s.bodies.map((body) => (
        <div key={body.fieldId} data-item-detail-body style={bodyStyle}>
          {body.kind === "richText" ? (
            renderTiptap(body.doc)
          ) : (
            <Render
              config={buildRenderConfig()}
              data={resolveTemplate(body.template, item, {
                currentItem: item,
                itemDef: def,
              })}
            />
          )}
        </div>
      ))}
      {s.extraImages.map((image) => (
        <div key={image.id} data-item-detail-cover style={coverStyle(image)}>
          <Image image={image} sizes="(max-width: 768px) 100vw, 768px" />
        </div>
      ))}
    </article>
  );
}

// ---------------------------------------------------------------------------
// Styles — token-driven inline styles, same convention as the card views.
// `[data-item-detail-cover] img` sizing lives in globals.css.
// ---------------------------------------------------------------------------

const articleStyle: CSSProperties = {
  maxWidth: "var(--max-width-content)",
  margin: "var(--space-8) auto",
  padding: "0 var(--space-4)",
};

/** Square / portrait art (release covers) stays narrow so it doesn't fill the fold. */
function coverStyle(image: ImageMetadata): CSSProperties {
  const isTall = image.width / image.height < 1.2;
  return {
    maxWidth: isTall ? "var(--max-width-narrow)" : undefined,
    margin: "0 0 var(--space-6)",
    borderRadius: "var(--img-radius, var(--radius))",
    overflow: "hidden",
  };
}

const headerStyle: CSSProperties = { marginBottom: "var(--space-6)" };

const metaStyle: CSSProperties = {
  margin: "0 0 var(--space-2)",
  fontSize: "var(--font-size-sm)",
  color: "var(--color-text-muted)",
};

const titleStyle: CSSProperties = { margin: 0 };

const subtitleStyle: CSSProperties = {
  margin: "var(--space-2) 0 0",
  fontSize: "var(--font-size-lg)",
  color: "var(--color-text-muted)",
};

const paragraphStyle: CSSProperties = {
  margin: "0 0 var(--space-4)",
  lineHeight: "var(--line-height-base)",
};

const linksStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "var(--space-3)",
  margin: "0 0 var(--space-6)",
};

const linkButtonStyle: CSSProperties = {
  display: "inline-block",
  padding: "var(--space-2) var(--space-4)",
  borderRadius: "var(--btn-radius, var(--radius))",
  border: "var(--border-width) solid var(--color-text)",
  color: "var(--color-text)",
  textDecoration: "none",
  fontSize: "var(--font-size-sm)",
  fontWeight: "var(--font-weight-semibold)" as unknown as number,
};

const bodyStyle: CSSProperties = { margin: "var(--space-6) 0" };
