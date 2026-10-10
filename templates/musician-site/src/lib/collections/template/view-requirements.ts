/**
 * Field requirements for the specialised Collection card views (#352).
 *
 * `specialized-views.tsx` renders tour dates, releases, posts, photos and
 * videos with hand-tuned cards that read fixed field ids. Artists keep
 * full schema control (#340), so any field that isn't `systemLocked` can
 * be retyped or deleted in the schema editor. Before this module, a card
 * whose field went away just dropped that piece silently.
 *
 * Each view now declares, per role, the field id it reads, the field
 * types it can render, and whether the card is meaningful without it:
 *
 *   - **required** — missing or retyped to an unaccepted type → the whole
 *     collection renders with the generic default card instead
 *     (`specialisedRendererForDef` returns null).
 *   - **optional** — missing or retyped → that piece of the card simply
 *     doesn't render.
 *
 * The schema editor reads the same declarations to warn the artist before
 * a delete / retype breaks a view (`viewFieldImpact`). A role can also
 * name a field the card doesn't read but the view still depends on: the
 * tour-dates `status`, which the default Collection block filters on. Renames are always
 * safe: views resolve by stable field id, never by `key`.
 *
 * Client-safe: type-only imports from `../schema` plus the node-free
 * `../field-ids` / `../field-classification`, so the `"use client"`
 * SchemaEditor can import it without pulling `node:crypto` into the
 * bundle (see the template CLAUDE.md "Client-bundle discipline").
 */

import type { ImageMetadata } from "@/lib/image-types";

import { canTransition, fieldTypeLabel } from "../field-classification";
import {
  PHOTOS_FIELD_IDS,
  POSTS_FIELD_IDS,
  RELEASES_FIELD_IDS,
  TOUR_DATES_FIELD_IDS,
  VIDEOS_FIELD_IDS,
} from "../field-ids";
import type { CollectionDef, FieldDef, FieldId, FieldType, FieldValue, Item } from "../schema";

// ---------------------------------------------------------------------------
// Declarations
// ---------------------------------------------------------------------------

/** Slugs that ship a specialised card renderer. */
export const SPECIALISED_VIEW_SLUGS = ["photos", "videos", "tour-dates", "releases", "posts"] as const;
export type SpecialisedViewSlug = (typeof SPECIALISED_VIEW_SLUGS)[number];

export function isSpecialisedViewSlug(slug: string): slug is SpecialisedViewSlug {
  return (SPECIALISED_VIEW_SLUGS as readonly string[]).includes(slug);
}

export type ViewFieldRequirement = {
  fieldId: FieldId;
  /** Artist-facing name of what the field does on the card ("ticket link"). */
  label: string;
  /** Field types the card can render for this role. */
  accepts: readonly FieldType[];
  /** True → the card can't render without it; the view falls back to the default card. */
  required: boolean;
  /**
   * What losing the field does on the public site, when the generic
   * copy ("the <label> will no longer show") would misstate it. `will`
   * completes a confirm prompt; `now` describes a draft that already
   * lost it.
   */
  effect?: { will: string; now: string };
};

export type ViewSpec = {
  /** Artist-facing name of the public view ("tour dates list"). */
  viewLabel: string;
  fields: Readonly<Record<string, ViewFieldRequirement>>;
};

// String-valued types each role can read. Mirrors the lossless
// transitions in `schema-changes.ts` (text ↔ longText, text ↔ url) so a
// lossless retype keeps the card intact rather than tripping the fallback.
const TEXTUAL = ["text", "longText"] as const satisfies readonly FieldType[];
const LINK = ["url", "text"] as const satisfies readonly FieldType[];

export const VIEW_REQUIREMENTS = {
  photos: {
    viewLabel: "photo grid",
    fields: {
      image: { fieldId: PHOTOS_FIELD_IDS.image, label: "photo", accepts: ["image"], required: true },
      // The tile falls back to the caption / credit saved on the image.
      caption: {
        fieldId: PHOTOS_FIELD_IDS.caption,
        label: "caption",
        accepts: TEXTUAL,
        required: false,
        effect: {
          will: "the public photo grid will only show the caption saved with each image",
          now: "the public photo grid only shows the caption saved with each image",
        },
      },
      credit: {
        fieldId: PHOTOS_FIELD_IDS.credit,
        label: "credit",
        accepts: TEXTUAL,
        required: false,
        effect: {
          will: "the public photo grid will only show the credit saved with each image",
          now: "the public photo grid only shows the credit saved with each image",
        },
      },
    },
  },
  videos: {
    viewLabel: "video grid",
    fields: {
      embedUrl: { fieldId: VIDEOS_FIELD_IDS.embedUrl, label: "video link", accepts: LINK, required: true },
      // Never displayed: it picks the embedded player. Without it,
      // `VideoEmbed` renders a link-out card.
      source: {
        fieldId: VIDEOS_FIELD_IDS.source,
        label: "video source",
        accepts: ["select"],
        required: false,
        effect: {
          will: "videos on the public video grid will show as links instead of embedded players",
          now: "videos on the public video grid show as links instead of embedded players",
        },
      },
      title: { fieldId: VIDEOS_FIELD_IDS.title, label: "title", accepts: TEXTUAL, required: false },
      thumbnail: { fieldId: VIDEOS_FIELD_IDS.thumbnail, label: "thumbnail", accepts: ["image"], required: false },
      description: { fieldId: VIDEOS_FIELD_IDS.description, label: "description", accepts: TEXTUAL, required: false },
    },
  },
  "tour-dates": {
    viewLabel: "tour dates list",
    fields: {
      date: { fieldId: TOUR_DATES_FIELD_IDS.date, label: "date", accepts: ["date"], required: true },
      venue: { fieldId: TOUR_DATES_FIELD_IDS.venue, label: "venue", accepts: TEXTUAL, required: true },
      city: { fieldId: TOUR_DATES_FIELD_IDS.city, label: "city", accepts: TEXTUAL, required: true },
      country: { fieldId: TOUR_DATES_FIELD_IDS.country, label: "country", accepts: TEXTUAL, required: false },
      ticketUrl: { fieldId: TOUR_DATES_FIELD_IDS.ticketUrl, label: "ticket link", accepts: LINK, required: false },
      // Not read by the card: the default tour-dates Collection block
      // filters out `status = cancelled` (`collection-view-props.ts`), and
      // a filter clause on a missing value fails, so every show drops out.
      // `notEquals` on a multi-choice value still works.
      status: {
        fieldId: TOUR_DATES_FIELD_IDS.status,
        label: "status",
        accepts: ["select", "multiSelect"],
        required: false,
        effect: {
          will: "tour dates lists that hide cancelled shows (the default) will hide every show",
          now: "tour dates lists that hide cancelled shows (the default) hide every show",
        },
      },
    },
  },
  releases: {
    viewLabel: "releases grid",
    fields: {
      title: { fieldId: RELEASES_FIELD_IDS.title, label: "title", accepts: TEXTUAL, required: true },
      coverImage: { fieldId: RELEASES_FIELD_IDS.coverImage, label: "cover art", accepts: ["image"], required: false },
      releaseType: { fieldId: RELEASES_FIELD_IDS.releaseType, label: "release type", accepts: ["select"], required: false },
      releaseDate: { fieldId: RELEASES_FIELD_IDS.releaseDate, label: "release year", accepts: ["date"], required: false },
      description: { fieldId: RELEASES_FIELD_IDS.description, label: "description", accepts: TEXTUAL, required: false },
    },
  },
  posts: {
    viewLabel: "posts grid",
    fields: {
      title: { fieldId: POSTS_FIELD_IDS.title, label: "title", accepts: TEXTUAL, required: true },
      coverImage: { fieldId: POSTS_FIELD_IDS.coverImage, label: "cover image", accepts: ["image"], required: false },
      category: { fieldId: POSTS_FIELD_IDS.category, label: "category", accepts: ["select"], required: false },
      publishedAt: { fieldId: POSTS_FIELD_IDS.publishedAt, label: "publish date", accepts: ["date"], required: false },
      summary: { fieldId: POSTS_FIELD_IDS.summary, label: "summary", accepts: TEXTUAL, required: false },
    },
  },
} as const satisfies Record<SpecialisedViewSlug, ViewSpec>;

/** The roles one view declares, e.g. `ViewRole<"tour-dates">` = `"date" | "venue" | …`. */
export type ViewRole<S extends SpecialisedViewSlug> = keyof (typeof VIEW_REQUIREMENTS)[S]["fields"] &
  string;

function viewSpec(slug: SpecialisedViewSlug): ViewSpec {
  return VIEW_REQUIREMENTS[slug];
}

// ---------------------------------------------------------------------------
// Checking a def against a view
// ---------------------------------------------------------------------------

export type ViewFieldStatus = "ok" | "missing" | "wrong-type";

/** Whether `fields` satisfies one requirement. Pure; looks only at the schema. */
export function checkFieldRequirement(
  fields: ReadonlyArray<FieldDef>,
  req: ViewFieldRequirement,
): ViewFieldStatus {
  const field = fields.find((f) => f.id === req.fieldId);
  if (!field) return "missing";
  return req.accepts.includes(field.type) ? "ok" : "wrong-type";
}

export type ViewFieldProblem = {
  role: string;
  requirement: ViewFieldRequirement;
  status: Exclude<ViewFieldStatus, "ok">;
  /** The field's current type when `status === "wrong-type"`. */
  actualType: FieldType | null;
};

/**
 * Every unmet requirement of `def`'s specialised view (empty when the
 * slug has no view, or when everything checks out).
 */
export function viewFieldProblems(def: Pick<CollectionDef, "slug" | "fields">): ViewFieldProblem[] {
  if (!isSpecialisedViewSlug(def.slug)) return [];
  const problems: ViewFieldProblem[] = [];
  for (const [role, requirement] of Object.entries(viewSpec(def.slug).fields)) {
    const status = checkFieldRequirement(def.fields, requirement);
    if (status === "ok") continue;
    const actualType = def.fields.find((f) => f.id === requirement.fieldId)?.type ?? null;
    // A type no accepted type converts to losslessly is a draft the save
    // API rejects (`type-transition-blocked`); the view never sees it, so
    // its save error is the only message the artist needs.
    if (actualType !== null && !requirement.accepts.some((t) => canTransition(t, actualType))) {
      continue;
    }
    problems.push({ role, requirement, status, actualType });
  }
  return problems;
}

/**
 * Field access for a specialised card, gated by the live schema. Each
 * reader returns null when the role's field is missing from the def,
 * retyped to an unaccepted type, or empty on this item — so a card never
 * renders a value it wasn't built for (and never throws on a stale
 * value the way the strict `accessors.ts` helpers do).
 */
export type ResolvedViewFields<S extends SpecialisedViewSlug> = {
  /** True when the role's field exists with an accepted type. */
  has(role: ViewRole<S>): boolean;
  /** String value for text / longText / url / select / date roles. */
  string(item: Item, role: ViewRole<S>): string | null;
  image(item: Item, role: ViewRole<S>): ImageMetadata | null;
};

/**
 * Resolve `def` against `slug`'s view. Returns null when any *required*
 * field is missing or has an incompatible type — the caller then renders
 * the default card. Optional problems leave the view usable; their
 * readers just return null.
 */
export function resolveViewFields<S extends SpecialisedViewSlug>(
  def: Pick<CollectionDef, "fields">,
  slug: S,
): ResolvedViewFields<S> | null {
  const spec = viewSpec(slug);
  const usable = new Map<string, ViewFieldRequirement>();
  for (const [role, requirement] of Object.entries(spec.fields)) {
    if (checkFieldRequirement(def.fields, requirement) === "ok") {
      usable.set(role, requirement);
    } else if (requirement.required) {
      return null;
    }
  }
  const read = (item: Item, role: string): FieldValue | null => {
    const requirement = usable.get(role);
    if (!requirement) return null;
    const value = item.values[requirement.fieldId];
    if (!value || !requirement.accepts.includes(value.type)) return null;
    return value;
  };
  return {
    has: (role) => usable.has(role),
    string: (item, role) => {
      const value = read(item, role);
      if (!value || typeof value.value !== "string") return null;
      return value.value === "" ? null : value.value;
    },
    image: (item, role) => {
      const value = read(item, role);
      return value?.type === "image" ? value.value : null;
    },
  };
}

// ---------------------------------------------------------------------------
// Schema-editor impact
// ---------------------------------------------------------------------------

export type ViewFieldChange = { kind: "remove" } | { kind: "retype"; from: FieldType; to: FieldType };

export type ViewFieldImpact = {
  viewLabel: string;
  requirement: ViewFieldRequirement;
  change: ViewFieldChange;
};

/**
 * What a remove / retype of `fieldId` would do to `def`'s specialised
 * view. Null when the field isn't one the view reads, when the change
 * keeps it working (a retype to another accepted type), or when the
 * retype is one the save API blocks (`canTransition`), since that can
 * never reach the public site.
 */
export function viewFieldImpact(
  def: Pick<CollectionDef, "slug">,
  fieldId: FieldId,
  change: ViewFieldChange,
): ViewFieldImpact | null {
  if (!isSpecialisedViewSlug(def.slug)) return null;
  const spec = viewSpec(def.slug);
  const requirement = Object.values(spec.fields).find((r) => r.fieldId === fieldId);
  if (!requirement) return null;
  if (change.kind === "retype") {
    if (requirement.accepts.includes(change.to)) return null;
    if (!canTransition(change.from, change.to)) return null;
  }
  return { viewLabel: spec.viewLabel, requirement, change };
}

function acceptedTypesLabel(requirement: ViewFieldRequirement): string {
  return requirement.accepts.map(fieldTypeLabel).join(" or ");
}

/** What happens on the public site, phrased for the artist. */
function consequence(
  viewLabel: string,
  requirement: ViewFieldRequirement,
  tense: "will" | "now",
): string {
  if (requirement.effect) return requirement.effect[tense];
  const needs = `its layout needs the ${requirement.label} as ${acceptedTypesLabel(requirement)}`;
  if (requirement.required) {
    return tense === "will"
      ? `the public ${viewLabel} will switch to the plain default card (${needs})`
      : `the public ${viewLabel} falls back to the plain default card (${needs})`;
  }
  return tense === "will"
    ? `the ${requirement.label} will no longer show on the public ${viewLabel}`
    : `the ${requirement.label} doesn't show on the public ${viewLabel}`;
}

/**
 * Confirm-dialog copy for a pending remove / retype, e.g.
 * `Removing "city" means the public tour dates list will switch to the
 * plain default card (…). Continue?`
 */
export function describeViewFieldImpact(impact: ViewFieldImpact, fieldKey: string): string {
  const action =
    impact.change.kind === "remove"
      ? `Removing "${fieldKey}"`
      : `Changing "${fieldKey}" to ${fieldTypeLabel(impact.change.to)}`;
  return `${action} means ${consequence(impact.viewLabel, impact.requirement, "will")}. Continue?`;
}

/** Persistent heads-up copy for a problem already present in the def. */
export function describeViewFieldProblem(
  def: Pick<CollectionDef, "slug">,
  problem: ViewFieldProblem,
): string {
  const viewLabel = isSpecialisedViewSlug(def.slug) ? viewSpec(def.slug).viewLabel : def.slug;
  const what =
    problem.status === "missing" || problem.actualType === null
      ? `The ${problem.requirement.label} field was removed`
      : `The ${problem.requirement.label} field is now ${fieldTypeLabel(problem.actualType)}`;
  return `${what}, so ${consequence(viewLabel, problem.requirement, "now")}.`;
}
