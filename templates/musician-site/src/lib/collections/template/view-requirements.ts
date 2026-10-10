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
 * tour-dates `status`, which the default Collection block filters on.
 *
 * Views find a role's field by its stable id first, so renaming a
 * declared field is safe. When that id is gone, a field whose name
 * matches the role (`city`, `ticketUrl`, `Ticket URL`, …; see
 * `findViewField`) stands in, so an artist who deletes a field and adds
 * it back gets the card back (#408). A stand-in holds the role only by
 * its name, so renaming *it* drops the role again; the heads-up says it
 * was renamed and which name restores it.
 *
 * Code that saved a declared id outside the schema (the default
 * Collection block's sort and filter, the detail page's "Tickets"
 * label) resolves it through `viewFieldIdFor`, so the same stand-in
 * takes over there too (#436).
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
  /**
   * False when a new field with the role's name mustn't take the role
   * over. Tour-date `status`: the default block hides shows whose status
   * is `cancelled`, and a filter clause on a missing value fails, so a
   * fresh status field (no show has a value yet) would hide every show
   * while the editor reported all clear. Left on the deleted id, the
   * block drops the clause (every upcoming show shows) and the heads-up
   * keeps saying the filter is ignored. Defaults to true.
   */
  matchesByKey?: boolean;
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
      // Optional: `TourDateRow` renders the place line from whichever of
      // city and country is left.
      city: { fieldId: TOUR_DATES_FIELD_IDS.city, label: "city", accepts: TEXTUAL, required: false },
      country: { fieldId: TOUR_DATES_FIELD_IDS.country, label: "country", accepts: TEXTUAL, required: false },
      ticketUrl: { fieldId: TOUR_DATES_FIELD_IDS.ticketUrl, label: "ticket link", accepts: LINK, required: false },
      // Not read by the card: the default tour-dates Collection block
      // filters out `status = cancelled` (`collection-view-props.ts`).
      // Once the field is gone the block drops that clause
      // (`resolveCollectionBlockProps`), so cancelled shows stop being
      // filtered out. `notEquals` on a multi-choice value still works.
      status: {
        fieldId: TOUR_DATES_FIELD_IDS.status,
        label: "status",
        accepts: ["select", "multiSelect"],
        required: false,
        matchesByKey: false,
        effect: {
          will:
            "tour dates lists that hide cancelled shows (the default) will ignore that filter " +
            "and show every upcoming show",
          now:
            "tour dates lists that hide cancelled shows (the default) ignore that filter " +
            "and show every upcoming show",
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

/** Every field id a view declares, so a renamed declared field can't stand in for another role. */
const DECLARED_FIELD_IDS: ReadonlySet<FieldId> = new Set(
  Object.values(VIEW_REQUIREMENTS).flatMap((spec: ViewSpec) =>
    Object.values(spec.fields).map((requirement) => requirement.fieldId),
  ),
);

/**
 * A field name reduced to what name matching compares: lower case,
 * letters and digits only, so `Ticket URL`, `ticket_url` and `ticketUrl`
 * all read as `ticketurl`. Every role is a distinct camelCase word, so
 * dropping spaces and punctuation can't make two roles collide.
 */
export function normaliseFieldKey(key: string): string {
  return key.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

/**
 * The field `role` reads in `fields`: the declared id when it's there,
 * otherwise (unless the role opts out) a field the artist named after
 * the role, compared by `normaliseFieldKey`. A declared field the artist
 * renamed never stands in for a different role.
 *
 * Keys are unique only as typed, so `City` (URL) and `city` (Short text)
 * can both match. The pick is the exact key first (`city` for the `city`
 * role), then a field whose type the role accepts, then field order.
 */
export function findViewField(
  fields: ReadonlyArray<FieldDef>,
  role: string,
  requirement: ViewFieldRequirement,
): FieldDef | undefined {
  const byId = fields.find((f) => f.id === requirement.fieldId);
  if (byId || requirement.matchesByKey === false) return byId;
  const key = normaliseFieldKey(role);
  const rank = (f: FieldDef): number =>
    (f.key.trim() === role ? 2 : 0) + (requirement.accepts.includes(f.type) ? 1 : 0);
  let best: FieldDef | undefined;
  for (const f of fields) {
    if (DECLARED_FIELD_IDS.has(f.id) || normaliseFieldKey(f.key) !== key) continue;
    if (!best || rank(f) > rank(best)) best = f;
  }
  return best;
}

/**
 * The id of the field that now plays the role `fieldId` was declared
 * for in `def`'s view: `fieldId` itself while it exists, else the
 * same-name stand-in `findViewField` picks, when its type is one the
 * role accepts (the card refuses any other, so the block does too).
 * Anything else (an id no view declares, a collection without a view, a
 * role with no usable stand-in) comes back unchanged.
 *
 * For ids saved outside the schema: the default Collection block's sort
 * and filter (`collection-view-props.ts`, resolved in
 * `collection-block.tsx`) and the detail page's "Tickets" label
 * (`item-detail.tsx`). Without it, a re-added `releaseDate` brought the
 * releases card back while the default block still sorted by the
 * deleted id. System-locked fields (tour-dates `date`, posts
 * `publishedAt`) can't be deleted, so they only take this path in
 * content edited outside the admin.
 */
export function viewFieldIdFor(
  def: Pick<CollectionDef, "slug" | "fields">,
  fieldId: FieldId,
): FieldId {
  if (!isSpecialisedViewSlug(def.slug) || def.fields.some((f) => f.id === fieldId)) return fieldId;
  for (const [role, requirement] of Object.entries(viewSpec(def.slug).fields)) {
    if (requirement.fieldId === fieldId) {
      const standIn = findViewField(def.fields, role, requirement);
      return standIn && requirement.accepts.includes(standIn.type) ? standIn.id : fieldId;
    }
  }
  return fieldId;
}

// ---------------------------------------------------------------------------
// Checking a def against a view
// ---------------------------------------------------------------------------

export type ViewFieldStatus = "ok" | "missing" | "wrong-type";

/** Whether `fields` satisfies one role's requirement. Pure; looks only at the schema. */
export function checkFieldRequirement(
  fields: ReadonlyArray<FieldDef>,
  role: string,
  req: ViewFieldRequirement,
): ViewFieldStatus {
  const field = findViewField(fields, role, req);
  if (!field) return "missing";
  return req.accepts.includes(field.type) ? "ok" : "wrong-type";
}

export type ViewFieldProblem = {
  role: string;
  requirement: ViewFieldRequirement;
  status: Exclude<ViewFieldStatus, "ok">;
  /** The field the role resolved to; null when `status === "missing"`. */
  field: FieldDef | null;
  /** The field's current type when `status === "wrong-type"`. */
  actualType: FieldType | null;
  /** That field's type as last saved; null for a field added in this draft. */
  savedType: FieldType | null;
  /** Why the role has no field; null unless `status === "missing"`. */
  missingCause: ViewFieldMissingCause | null;
};

/**
 * Why a role has no field, judged against the saved def:
 *
 *   - `removed`: the saved def had a field for it; the draft deleted it.
 *   - `renamed`: the saved def's field was a same-name stand-in and the
 *     draft renamed it (now `field.key`), so it no longer matches. A
 *     declared field resolves by id, so renaming one never lands here.
 *   - `absent`: the saved def had no field for it either.
 */
export type ViewFieldMissingCause =
  | { kind: "removed" }
  | { kind: "renamed"; field: FieldDef; savedKey: string }
  | { kind: "absent" };

function missingCause(
  def: Pick<CollectionDef, "fields">,
  savedDef: Pick<CollectionDef, "fields">,
  role: string,
  requirement: ViewFieldRequirement,
): ViewFieldMissingCause {
  const savedField = findViewField(savedDef.fields, role, requirement);
  if (!savedField) return { kind: "absent" };
  const draftField = def.fields.find((f) => f.id === savedField.id);
  return draftField
    ? { kind: "renamed", field: draftField, savedKey: savedField.key.trim() }
    : { kind: "removed" };
}

/**
 * Every unmet requirement of `def`'s specialised view (empty when the
 * slug has no view, or when everything checks out). `savedDef` is the
 * schema as last saved, when `def` is an unsaved draft of it.
 */
export function viewFieldProblems(
  def: Pick<CollectionDef, "slug" | "fields">,
  savedDef: Pick<CollectionDef, "fields"> = def,
): ViewFieldProblem[] {
  if (!isSpecialisedViewSlug(def.slug)) return [];
  const problems: ViewFieldProblem[] = [];
  for (const [role, requirement] of Object.entries(viewSpec(def.slug).fields)) {
    const status = checkFieldRequirement(def.fields, role, requirement);
    if (status === "ok") continue;
    const field = findViewField(def.fields, role, requirement) ?? null;
    const actualType = field?.type ?? null;
    // A retype from the saved type the save API rejects
    // (`type-transition-blocked`) never reaches the view, so its save
    // error is the only message the artist needs.
    const savedType = (field && savedDef.fields.find((f) => f.id === field.id)?.type) ?? null;
    if (actualType !== null && savedType !== null && !canTransition(savedType, actualType)) {
      continue;
    }
    problems.push({
      role,
      requirement,
      status,
      field,
      actualType,
      savedType,
      missingCause: status === "missing" ? missingCause(def, savedDef, role, requirement) : null,
    });
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
  // Role → the requirement plus the id of the field it resolved to.
  const usable = new Map<string, { requirement: ViewFieldRequirement; fieldId: FieldId }>();
  for (const [role, requirement] of Object.entries(spec.fields)) {
    const field = findViewField(def.fields, role, requirement);
    if (field && requirement.accepts.includes(field.type)) {
      usable.set(role, { requirement, fieldId: field.id });
    } else if (requirement.required) {
      return null;
    }
  }
  const read = (item: Item, role: string): FieldValue | null => {
    const match = usable.get(role);
    if (!match) return null;
    const value = item.values[match.fieldId];
    if (!value || !match.requirement.accepts.includes(value.type)) return null;
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

/**
 * `from` is the field's *saved* type: the save API checks transitions
 * against it, not against an earlier unsaved retype.
 */
export type ViewFieldChange = { kind: "remove" } | { kind: "retype"; from: FieldType; to: FieldType };

export type ViewFieldImpact = {
  viewLabel: string;
  requirement: ViewFieldRequirement;
  change: ViewFieldChange;
};

/**
 * What a remove / retype of `fieldId` would do to `def`'s specialised
 * view. Null when the field isn't one the view reads, when the change
 * keeps the role working (a retype to another accepted type, or another
 * field with the role's name waiting to take over), when the
 * retype is one the save API blocks (`canTransition`), since that can
 * never reach the public site, or when the draft already breaks that
 * role: the heads-up already says what happens, and a further change
 * doesn't add to it. `savedDef` is the schema as last saved.
 */
export function viewFieldImpact(
  def: Pick<CollectionDef, "slug" | "fields">,
  fieldId: FieldId,
  change: ViewFieldChange,
  savedDef: Pick<CollectionDef, "fields"> = def,
): ViewFieldImpact | null {
  if (!isSpecialisedViewSlug(def.slug)) return null;
  const spec = viewSpec(def.slug);
  const match = Object.entries(spec.fields).find(
    ([role, r]) => findViewField(def.fields, role, r)?.id === fieldId,
  );
  if (!match) return null;
  const [role, requirement] = match;
  if (viewFieldProblems(def, savedDef).some((p) => p.role === role)) return null;
  if (change.kind === "retype" && !canTransition(change.from, change.to)) return null;
  // Judge the role on the fields as they'd be after the change: a retype
  // to an accepted type keeps it, and so does a waiting same-name field
  // (declared `ticketUrl` renamed to `tickets` and a new `ticketUrl`
  // added: removing `tickets` hands the role to the new field).
  const after =
    change.kind === "remove"
      ? def.fields.filter((f) => f.id !== fieldId)
      : def.fields.map((f) => (f.id === fieldId ? ({ ...f, type: change.to } as FieldDef) : f));
  if (checkFieldRequirement(after, role, requirement) === "ok") return null;
  return { viewLabel: spec.viewLabel, requirement, change };
}

/**
 * Whether a saveable retype can still be rejected by an existing value.
 * A retype's save re-validates every item under the new type
 * (`validateSchemaChange`), so free text that isn't a valid URL blocks
 * it. select → multi-choice can't fail (each value is wrapped), and
 * neither can a retype to Long text, which has no constraints.
 */
function retypeCanFailOnValues(from: FieldType, to: FieldType): boolean {
  return !(to === "longText" || (from === "select" && to === "multiSelect"));
}

/** The caveat both the confirm and the heads-up add to a retype that existing values can block. */
function retypeCaveat(fieldKey: string, from: FieldType, to: FieldType): string {
  if (!retypeCanFailOnValues(from, to)) return "";
  return ` The save only goes through if every existing ${fieldKey} is a valid ${fieldTypeLabel(to)} value.`;
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
 * `Removing "city" means the city will no longer show on the public
 * tour dates list. Continue?`
 *
 * The editor can't see items, so a retype that existing values can
 * block says so (`retypeCaveat`). Removing a role that doesn't match by
 * name says re-adding it won't help.
 */
export function describeViewFieldImpact(impact: ViewFieldImpact, fieldKey: string): string {
  const what = consequence(impact.viewLabel, impact.requirement, "will");
  if (impact.change.kind === "remove") {
    const noWayBack =
      impact.requirement.matchesByKey === false
        ? ` Adding a new "${fieldKey}" field later won't undo this.`
        : "";
    return `Removing "${fieldKey}" means ${what}.${noWayBack} Continue?`;
  }
  const { from, to } = impact.change;
  return (
    `Changing "${fieldKey}" to ${fieldTypeLabel(to)} means ${what}.` +
    `${retypeCaveat(fieldKey, from, to)} Continue?`
  );
}

/**
 * Persistent heads-up copy for a problem already present in the def. A
 * missing role that a same-name field can fill names the field name
 * that does it; an unsaved rename of a stand-in reads as a rename, not
 * a removal.
 */
export function describeViewFieldProblem(
  def: Pick<CollectionDef, "slug">,
  problem: ViewFieldProblem,
): string {
  const viewLabel = isSpecialisedViewSlug(def.slug) ? viewSpec(def.slug).viewLabel : def.slug;
  const { role, requirement, field, actualType, savedType } = problem;
  const now = consequence(viewLabel, requirement, "now");
  if (problem.status === "wrong-type" && field && actualType !== null) {
    // An unsaved retype that existing values can still block.
    const caveat =
      savedType !== null && savedType !== actualType
        ? retypeCaveat(field.key, savedType, actualType)
        : "";
    return `The ${requirement.label} field is now ${fieldTypeLabel(actualType)}, so ${now}.${caveat}`;
  }
  // A role that doesn't match by name has no way back to suggest.
  if (requirement.matchesByKey === false) {
    return `The ${requirement.label} field was removed, so ${now}.`;
  }
  const cause = problem.missingCause ?? { kind: "absent" };
  const restore = `Name a field "${role}" to bring it back.`;
  switch (cause.kind) {
    case "renamed":
      // Mid-edit: the artist cleared the name before typing a new one.
      if (!cause.field.key.trim()) {
        return (
          `The ${requirement.label} field has no name, so ${now}. ` +
          `Name it "${cause.savedKey}" again to undo this.`
        );
      }
      return (
        `The ${requirement.label} field was renamed to "${cause.field.key}", so ${now}. ` +
        `Name it "${cause.savedKey}" again to undo this.`
      );
    case "removed":
      return `The ${requirement.label} field was removed, so ${now}. ${restore}`;
    case "absent":
      return `There's no ${requirement.label} field, so ${now}. ${restore}`;
  }
}
