import { describe, expect, it } from "vitest";

import { asImageId, type ImageMetadata } from "@/lib/image-types";

import { PHOTOS_FIELD_IDS, TOUR_DATES_FIELD_IDS, VIDEOS_FIELD_IDS } from "../field-ids";
import type { CollectionDef, FieldDef, Item } from "../schema";
import {
  photosCollectionDef,
  postsCollectionDef,
  releasesCollectionDef,
  tourDatesCollectionDef,
  videosCollectionDef,
} from "../seeds";
import {
  checkFieldRequirement,
  describeViewFieldImpact,
  describeViewFieldProblem,
  findViewField,
  isSpecialisedViewSlug,
  normaliseFieldKey,
  resolveViewFields,
  SPECIALISED_VIEW_SLUGS,
  VIEW_REQUIREMENTS,
  viewFieldIdFor,
  viewFieldImpact,
  viewFieldProblems,
} from "./view-requirements";

const TS = { createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };

const SEED_DEFS: Record<string, CollectionDef> = {
  photos: photosCollectionDef,
  videos: videosCollectionDef,
  "tour-dates": tourDatesCollectionDef,
  releases: releasesCollectionDef,
  posts: postsCollectionDef,
};

const CITY = VIEW_REQUIREMENTS["tour-dates"].fields.city;
const TICKETS = VIEW_REQUIREMENTS["tour-dates"].fields.ticketUrl;
const COUNTRY = VIEW_REQUIREMENTS["tour-dates"].fields.country;
const VENUE = VIEW_REQUIREMENTS["tour-dates"].fields.venue;
const STATUS = VIEW_REQUIREMENTS["tour-dates"].fields.status;

/** The tour-dates seed with `city` removed and a new field of `key` added in its place. */
function tourDatesWithReAdded(key: string, type: "text" | "url" = "text"): CollectionDef {
  const base = tourDatesWith(CITY.fieldId, null);
  return {
    ...base,
    fields: [...base.fields, { id: "fld_readded", key, type, required: false } as FieldDef],
  };
}

/** The tour-dates seed with city retyped to URL. */
const CITY_AS_URL = tourDatesWith(TOUR_DATES_FIELD_IDS.city, {
  id: TOUR_DATES_FIELD_IDS.city,
  key: "city",
  type: "url",
  required: false,
});

/** The tour-dates seed with one field swapped out (or removed when `next` is null). */
function tourDatesWith(fieldId: string, next: FieldDef | null): CollectionDef {
  return {
    ...tourDatesCollectionDef,
    fields: tourDatesCollectionDef.fields.flatMap((f) =>
      f.id !== fieldId ? [f] : next ? [next] : [],
    ),
  };
}

function tourItem(values: Item["values"]): Item {
  return { id: "item_t", slug: "t1", ...TS, values };
}

// ---------------------------------------------------------------------------
// Declarations vs. the shipped seeds
// ---------------------------------------------------------------------------

describe("VIEW_REQUIREMENTS", () => {
  it("declares one entry per specialised slug", () => {
    expect(Object.keys(VIEW_REQUIREMENTS).sort()).toEqual([...SPECIALISED_VIEW_SLUGS].sort());
  });

  it.each(SPECIALISED_VIEW_SLUGS)("is satisfied by the shipped %s seed", (slug) => {
    expect(viewFieldProblems(SEED_DEFS[slug]!)).toEqual([]);
    expect(resolveViewFields(SEED_DEFS[slug]!, slug)).not.toBeNull();
  });

  it("narrows slugs", () => {
    expect(isSpecialisedViewSlug("tour-dates")).toBe(true);
    expect(isSpecialisedViewSlug("store-items")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// checkFieldRequirement — one case per branch
// ---------------------------------------------------------------------------

describe("checkFieldRequirement", () => {
  it("is ok when the field is present with an accepted type", () => {
    expect(checkFieldRequirement(tourDatesCollectionDef.fields, "city", CITY)).toBe("ok");
  });

  it("accepts a lossless retype the view can still render (text → longText)", () => {
    const def = tourDatesWith(CITY.fieldId, {
      id: CITY.fieldId,
      key: "city",
      type: "longText",
      required: true,
    });
    expect(checkFieldRequirement(def.fields, "city", CITY)).toBe("ok");
  });

  it("is missing when the field was deleted", () => {
    expect(checkFieldRequirement(tourDatesWith(CITY.fieldId, null).fields, "city", CITY)).toBe("missing");
  });

  it("is wrong-type when the field was retyped to something the view can't render", () => {
    const def = tourDatesWith(CITY.fieldId, {
      id: CITY.fieldId,
      key: "city",
      type: "number",
      required: true,
    });
    expect(checkFieldRequirement(def.fields, "city", CITY)).toBe("wrong-type");
  });

  it("ignores renames — fields resolve by id, not key", () => {
    const def = tourDatesWith(CITY.fieldId, {
      id: CITY.fieldId,
      key: "town",
      type: "text",
      required: true,
    });
    expect(checkFieldRequirement(def.fields, "city", CITY)).toBe("ok");
  });

  it("matches a re-added field by name once the declared id is gone", () => {
    expect(checkFieldRequirement(tourDatesWithReAdded(" City ").fields, "city", CITY)).toBe("ok");
    expect(checkFieldRequirement(tourDatesWithReAdded("city", "url").fields, "city", CITY)).toBe(
      "wrong-type",
    );
    expect(checkFieldRequirement(tourDatesWithReAdded("town").fields, "city", CITY)).toBe("missing");
  });

  it("never lets another declared field stand in, even renamed to the role's name", () => {
    const def = tourDatesWith(CITY.fieldId, null);
    const renamedCountry = {
      ...def,
      fields: def.fields.map((f) => (f.id === COUNTRY.fieldId ? { ...f, key: "city" } : f)),
    };
    expect(checkFieldRequirement(renamedCountry.fields, "city", CITY)).toBe("missing");
  });

  it("doesn't match by name for a role whose dependency is on the id (tour-date status)", () => {
    const base = tourDatesWith(STATUS.fieldId, null);
    const fields = [
      ...base.fields,
      { id: "fld_readded", key: "status", type: "select", required: false, options: [] } as FieldDef,
    ];
    expect(checkFieldRequirement(fields, "status", STATUS)).toBe("missing");
  });
});

// ---------------------------------------------------------------------------
// resolveViewFields — fallback decision + gated readers
// ---------------------------------------------------------------------------

describe("resolveViewFields", () => {
  it("returns null (→ default card) when a required field is missing", () => {
    expect(resolveViewFields(tourDatesWith(VENUE.fieldId, null), "tour-dates")).toBeNull();
  });

  it("keeps the view when city is missing — it's optional", () => {
    const fields = resolveViewFields(tourDatesWith(CITY.fieldId, null), "tour-dates");
    expect(fields?.has("city")).toBe(false);
  });

  it("reads a re-added same-name field's values under its new id", () => {
    const fields = resolveViewFields(tourDatesWithReAdded("city"), "tour-dates")!;
    expect(fields.has("city")).toBe(true);
    const item = tourItem({ fld_readded: { type: "text", value: "Lisbon" } });
    expect(fields.string(item, "city")).toBe("Lisbon");
  });

  it("returns null when a required field has an incompatible type", () => {
    const videosWithEmbedAsImage: CollectionDef = {
      ...videosCollectionDef,
      fields: videosCollectionDef.fields.map((f) =>
        f.id === VIDEOS_FIELD_IDS.embedUrl ? { id: f.id, key: f.key, type: "image", required: true } : f,
      ),
    };
    expect(resolveViewFields(videosWithEmbedAsImage, "videos")).toBeNull();
    const retyped = tourDatesWith(VENUE.fieldId, {
      id: VENUE.fieldId,
      key: "venue",
      type: "image",
      required: true,
    });
    expect(resolveViewFields(retyped, "tour-dates")).toBeNull();
  });

  it("stays usable when an optional field is missing; its reader returns null", () => {
    const fields = resolveViewFields(tourDatesWith(TICKETS.fieldId, null), "tour-dates");
    expect(fields).not.toBeNull();
    expect(fields!.has("ticketUrl")).toBe(false);
    expect(fields!.has("city")).toBe(true);
    // A stale value left on the item is ignored once the field is gone.
    const item = tourItem({ [TICKETS.fieldId]: { type: "url", value: "https://tix.example" } });
    expect(fields!.string(item, "ticketUrl")).toBeNull();
  });

  it("treats an optional field with an incompatible type as absent", () => {
    const def = tourDatesWith(TICKETS.fieldId, {
      id: TICKETS.fieldId,
      key: "ticketUrl",
      type: "boolean",
    });
    const fields = resolveViewFields(def, "tour-dates")!;
    expect(fields.has("ticketUrl")).toBe(false);
  });

  it("reads string values for every accepted type and drops empty strings", () => {
    const fields = resolveViewFields(tourDatesCollectionDef, "tour-dates")!;
    const item = tourItem({
      [TOUR_DATES_FIELD_IDS.city]: { type: "longText", value: "Madrid" },
      [TOUR_DATES_FIELD_IDS.venue]: { type: "text", value: "" },
      [TOUR_DATES_FIELD_IDS.date]: { type: "date", value: "2026-08-01" },
    });
    expect(fields.string(item, "city")).toBe("Madrid");
    expect(fields.string(item, "venue")).toBeNull();
    expect(fields.string(item, "date")).toBe("2026-08-01");
    expect(fields.string(item, "country")).toBeNull(); // no value on the item
  });

  it("returns null (instead of throwing) for a value whose type the role doesn't accept", () => {
    const fields = resolveViewFields(tourDatesCollectionDef, "tour-dates")!;
    const item = tourItem({ [TOUR_DATES_FIELD_IDS.city]: { type: "number", value: 3 } });
    expect(fields.string(item, "city")).toBeNull();
  });

  it("returns null for a stale string value of a type the role doesn't accept", () => {
    // String-valued, so only the per-value type check keeps it off the card.
    const fields = resolveViewFields(tourDatesCollectionDef, "tour-dates")!;
    const item = tourItem({ [TOUR_DATES_FIELD_IDS.city]: { type: "email", value: "a@b.example" } });
    expect(fields.string(item, "city")).toBeNull();
  });

  it("reads images only from image values", () => {
    const fields = resolveViewFields(photosCollectionDef, "photos")!;
    const image: ImageMetadata = {
      id: asImageId("img_1"),
      alt: "Live",
      width: 800,
      height: 600,
      placeholderDataUri: "data:image/webp;base64,AAAA",
      contentSlug: "live",
      originalExt: "jpg",
    };
    const item: Item = {
      id: "p",
      slug: "p",
      ...TS,
      values: {
        [PHOTOS_FIELD_IDS.image]: { type: "image", value: image },
        [PHOTOS_FIELD_IDS.caption]: { type: "text", value: "On stage" },
      },
    };
    expect(fields.image(item, "image")).toBe(image);
    expect(fields.image(item, "caption")).toBeNull();
    const empty: Item = { id: "p", slug: "p", ...TS, values: {} };
    expect(fields.image(empty, "image")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// viewFieldProblems
// ---------------------------------------------------------------------------

describe("viewFieldProblems", () => {
  it("returns [] for collections without a specialised view", () => {
    expect(viewFieldProblems({ slug: "store-items", fields: [] })).toEqual([]);
  });

  it("lists missing and wrong-type fields with the field's current type", () => {
    const def = tourDatesWith(CITY.fieldId, {
      id: CITY.fieldId,
      key: "city",
      type: "url",
      required: true,
    });
    const withoutTickets = { ...def, fields: def.fields.filter((f) => f.id !== TICKETS.fieldId) };
    const problems = viewFieldProblems(withoutTickets);
    expect(problems.map((p) => [p.role, p.status, p.actualType])).toEqual([
      ["city", "wrong-type", "url"],
      ["ticketUrl", "missing", null],
    ]);
  });

  it("skips a retype the save API blocks from the saved type — that draft never reaches the view", () => {
    const def = tourDatesWith(CITY.fieldId, {
      id: CITY.fieldId,
      key: "city",
      type: "number",
      required: true,
    });
    expect(viewFieldProblems(def, tourDatesCollectionDef)).toEqual([]);
    // Without a saved def there's nothing to check against, so it's listed.
    expect(viewFieldProblems(def).map((p) => p.role)).toEqual(["city"]);
  });

  it("judges a two-step retype against the saved type, not the draft's", () => {
    // ticketUrl saved as URL, retyped to Short text then Email in the
    // draft: URL → Email is blocked on save, so no heads-up.
    const twoStep = tourDatesWith(TICKETS.fieldId, {
      id: TICKETS.fieldId,
      key: "ticketUrl",
      type: "email",
      required: false,
    });
    expect(viewFieldProblems(twoStep, tourDatesCollectionDef)).toEqual([]);
    // city saved as Short text, draft Number then URL: Short text → URL
    // saves, so it's listed.
    const cityUrl = tourDatesWith(CITY.fieldId, {
      id: CITY.fieldId,
      key: "city",
      type: "url",
      required: true,
    });
    expect(viewFieldProblems(cityUrl, tourDatesCollectionDef).map((p) => p.role)).toEqual(["city"]);
  });
});

// ---------------------------------------------------------------------------
// viewFieldImpact + copy
// ---------------------------------------------------------------------------

describe("viewFieldImpact", () => {
  it("flags removing a required field", () => {
    const impact = viewFieldImpact(tourDatesCollectionDef, VENUE.fieldId, { kind: "remove" });
    expect(impact?.requirement).toBe(VENUE);
    expect(impact?.viewLabel).toBe("tour dates list");
  });

  it("flags removing a re-added same-name field", () => {
    const impact = viewFieldImpact(tourDatesWithReAdded("city"), "fld_readded", { kind: "remove" });
    expect(impact?.requirement).toBe(CITY);
  });

  it("skips a change to a field the draft already broke — the heads-up covers it", () => {
    // city saved as Short text, URL in the draft: the heads-up already
    // says what happens, so a further retype or a removal doesn't ask.
    expect(
      viewFieldImpact(
        CITY_AS_URL,
        CITY.fieldId,
        { kind: "retype", from: "text", to: "email" },
        tourDatesCollectionDef,
      ),
    ).toBeNull();
    expect(
      viewFieldImpact(CITY_AS_URL, CITY.fieldId, { kind: "remove" }, tourDatesCollectionDef),
    ).toBeNull();
    // A draft retype the save API blocks isn't a standing problem, so a
    // saveable change from it still asks.
    const cityAsNumber = tourDatesWith(CITY.fieldId, {
      id: CITY.fieldId,
      key: "city",
      type: "number",
      required: false,
    });
    expect(
      viewFieldImpact(
        cityAsNumber,
        CITY.fieldId,
        { kind: "retype", from: "text", to: "url" },
        tourDatesCollectionDef,
      ),
    ).not.toBeNull();
  });

  it("flags removing an optional field", () => {
    const impact = viewFieldImpact(tourDatesCollectionDef, TICKETS.fieldId, { kind: "remove" });
    expect(impact?.requirement.required).toBe(false);
  });

  it("flags a saveable retype to a type the view can't render", () => {
    expect(
      viewFieldImpact(tourDatesCollectionDef, CITY.fieldId, { kind: "retype", from: "text", to: "url" }),
    ).not.toBeNull();
  });

  it("ignores a retype the save API blocks", () => {
    // text → number is `type-transition-blocked` on save; warning about the
    // public site would promise a change that can't happen.
    expect(
      viewFieldImpact(tourDatesCollectionDef, CITY.fieldId, { kind: "retype", from: "text", to: "number" }),
    ).toBeNull();
  });

  it("allows a retype to another accepted type", () => {
    expect(
      viewFieldImpact(tourDatesCollectionDef, CITY.fieldId, {
        kind: "retype",
        from: "text",
        to: "longText",
      }),
    ).toBeNull();
  });

  it("ignores fields the view doesn't read and collections without a view", () => {
    expect(
      viewFieldImpact(tourDatesCollectionDef, TOUR_DATES_FIELD_IDS.notes, { kind: "remove" }),
    ).toBeNull();
    expect(
      viewFieldImpact({ slug: "store-items", fields: [] }, CITY.fieldId, { kind: "remove" }),
    ).toBeNull();
  });
});

describe("describeViewFieldImpact / describeViewFieldProblem", () => {
  it("explains the default-card fallback for a required field", () => {
    const impact = viewFieldImpact(tourDatesCollectionDef, VENUE.fieldId, { kind: "remove" })!;
    expect(describeViewFieldImpact(impact, "venue")).toBe(
      'Removing "venue" means the public tour dates list will switch to the plain default card ' +
        "(its layout needs the venue as Short text or Long text). Continue?",
    );
  });

  it("explains a hidden city now that city is optional", () => {
    const impact = viewFieldImpact(tourDatesCollectionDef, CITY.fieldId, { kind: "remove" })!;
    expect(describeViewFieldImpact(impact, "city")).toBe(
      'Removing "city" means the city will no longer show on the public tour dates list. Continue?',
    );
  });

  it("leaves out the existing-values caveat for select → multi-choice, which always saves", () => {
    const impact = viewFieldImpact(videosCollectionDef, VIDEOS_FIELD_IDS.source, {
      kind: "retype",
      from: "select",
      to: "multiSelect",
    })!;
    expect(describeViewFieldImpact(impact, "source")).toBe(
      'Changing "source" to Multi-choice means videos on the public video grid will show as ' +
        "links instead of embedded players. Continue?",
    );
  });

  it("leaves out the existing-values caveat for a retype to Long text, which always saves", () => {
    const ticketsAsText = tourDatesWith(TICKETS.fieldId, {
      ...tourDatesCollectionDef.fields.find((f) => f.id === TICKETS.fieldId)!,
      type: "text",
    } as FieldDef);
    const impact = viewFieldImpact(ticketsAsText, TICKETS.fieldId, {
      kind: "retype",
      from: "text",
      to: "longText",
    })!;
    expect(describeViewFieldImpact(impact, "ticketUrl")).toBe(
      'Changing "ticketUrl" to Long text means the ticket link will no longer show on the ' +
        "public tour dates list. Continue?",
    );
  });

  it("explains a hidden piece for an optional field, naming the new type on retype", () => {
    const impact = viewFieldImpact(tourDatesCollectionDef, COUNTRY.fieldId, {
      kind: "retype",
      from: "text",
      to: "email",
    })!;
    expect(describeViewFieldImpact(impact, "country")).toBe(
      'Changing "country" to Email means the country will no longer show on the ' +
        "public tour dates list. The save only goes through if every existing country is a " +
        "valid Email value. Continue?",
    );
  });

  it("uses a role's own effect copy where the generic copy would misstate it", () => {
    const source = viewFieldImpact(videosCollectionDef, VIDEOS_FIELD_IDS.source, { kind: "remove" })!;
    expect(describeViewFieldImpact(source, "source")).toBe(
      'Removing "source" means videos on the public video grid will show as links instead of ' +
        "embedded players. Continue?",
    );
    const caption = viewFieldImpact(photosCollectionDef, PHOTOS_FIELD_IDS.caption, { kind: "remove" })!;
    expect(describeViewFieldImpact(caption, "caption")).toBe(
      'Removing "caption" means the public photo grid will only show the caption saved with ' +
        "each image. Continue?",
    );
  });

  it("warns that removing tour-date status stops lists hiding cancelled shows", () => {
    // The default tour-dates block filters `status notEquals cancelled`;
    // once the field is gone the block drops that clause.
    const impact = viewFieldImpact(tourDatesCollectionDef, TOUR_DATES_FIELD_IDS.status, {
      kind: "remove",
    })!;
    expect(describeViewFieldImpact(impact, "status")).toBe(
      'Removing "status" means tour dates lists that hide cancelled shows (the default) will ' +
        "ignore that filter, so cancelled shows are listed too. " +
        'Adding a new "status" field later won\'t undo this. Continue?',
    );
    const [problem] = viewFieldProblems(tourDatesWith(TOUR_DATES_FIELD_IDS.status, null));
    expect(describeViewFieldProblem(tourDatesCollectionDef, problem!)).toBe(
      "The status field was removed, so tour dates lists that hide cancelled shows (the " +
        "default) ignore that filter, so cancelled shows are listed too.",
    );
    // select → multiSelect keeps the filter working, so it doesn't warn.
    expect(
      viewFieldImpact(tourDatesCollectionDef, TOUR_DATES_FIELD_IDS.status, {
        kind: "retype",
        from: "select",
        to: "multiSelect",
      }),
    ).toBeNull();
  });

  it("describes a standing problem in the present tense", () => {
    const def = tourDatesWith(VENUE.fieldId, {
      id: VENUE.fieldId,
      key: "venue",
      type: "url",
      required: true,
    });
    const [problem] = viewFieldProblems(def);
    expect(describeViewFieldProblem(def, problem!)).toBe(
      "The venue field is now URL, so the public tour dates list falls back to the plain " +
        "default card (its layout needs the venue as Short text or Long text).",
    );
    // Without a saved def to compare against, the copy can't claim the
    // field was removed; it says what's missing and which name fills it.
    const [absent] = viewFieldProblems(tourDatesWith(TICKETS.fieldId, null));
    expect(describeViewFieldProblem(tourDatesCollectionDef, absent!)).toBe(
      "There's no ticket link field, so the ticket link doesn't show on the public tour dates " +
        'list. Name a field "ticketUrl" to bring it back.',
    );
  });

  it("says a field removed in the draft was removed, and which name brings it back", () => {
    const [removed] = viewFieldProblems(tourDatesWith(TICKETS.fieldId, null), tourDatesCollectionDef);
    expect(removed?.missingCause).toEqual({ kind: "removed" });
    expect(describeViewFieldProblem(tourDatesCollectionDef, removed!)).toBe(
      "The ticket link field was removed, so the ticket link doesn't show on the public tour " +
        'dates list. Name a field "ticketUrl" to bring it back.',
    );
  });

  it("adds the existing-values caveat to an unsaved retype that existing values can block", () => {
    const [problem] = viewFieldProblems(CITY_AS_URL, tourDatesCollectionDef);
    expect(describeViewFieldProblem(CITY_AS_URL, problem!)).toBe(
      "The city field is now URL, so the city doesn't show on the public tour dates list. " +
        "The save only goes through if every existing city is a valid URL value.",
    );
  });

  it("leaves the caveat out of the heads-up for select → multi-choice", () => {
    const def: CollectionDef = {
      ...videosCollectionDef,
      fields: videosCollectionDef.fields.map((f) =>
        f.id === VIDEOS_FIELD_IDS.source ? ({ ...f, type: "multiSelect" } as FieldDef) : f,
      ),
    };
    const [problem] = viewFieldProblems(def, videosCollectionDef);
    expect(describeViewFieldProblem(def, problem!)).toBe(
      "The video source field is now Multi-choice, so videos on the public video grid show as " +
        "links instead of embedded players.",
    );
  });
});

// ---------------------------------------------------------------------------
// #436 follow-ups: name matching, renames, waiting fields, saved ids
// ---------------------------------------------------------------------------

/** A plain field for the tests below. */
function field(id: string, key: string, type: "text" | "url" | "date" = "text"): FieldDef {
  return { id, key, type, required: false } as FieldDef;
}

/** The tour-dates seed with `fieldId` removed and `extra` appended. */
function tourDatesSwapping(fieldId: string, ...extra: FieldDef[]): CollectionDef {
  const base = tourDatesWith(fieldId, null);
  return { ...base, fields: [...base.fields, ...extra] };
}

describe("normaliseFieldKey / name matching", () => {
  it("drops case, spaces and punctuation", () => {
    expect(normaliseFieldKey("Ticket URL")).toBe("ticketurl");
    expect(normaliseFieldKey(" ticket_url ")).toBe("ticketurl");
    expect(normaliseFieldKey("ticket-Url")).toBe("ticketurl");
    expect(normaliseFieldKey("ticketUrl")).toBe("ticketurl");
  });

  it("keeps letters and digits outside ASCII", () => {
    expect(normaliseFieldKey("Città 2")).toBe("città2");
  });

  it.each(["Ticket URL", "ticket url", "ticket_url", "ticket-url", "TICKETURL"])(
    "lets a re-added %j stand in for ticketUrl",
    (key) => {
      const def = tourDatesSwapping(TICKETS.fieldId, field("fld_new", key, "url"));
      expect(checkFieldRequirement(def.fields, "ticketUrl", TICKETS)).toBe("ok");
    },
  );

  it("still needs every letter of the role's name", () => {
    const def = tourDatesSwapping(TICKETS.fieldId, field("fld_new", "tickets", "url"));
    expect(checkFieldRequirement(def.fields, "ticketUrl", TICKETS)).toBe("missing");
  });

  it("gives every role a distinct normalised name, so no field can match two roles", () => {
    for (const spec of Object.values(VIEW_REQUIREMENTS)) {
      const roles = Object.keys(spec.fields).map(normaliseFieldKey);
      expect(new Set(roles).size).toBe(roles.length);
    }
  });
});

describe("findViewField — several same-name fields", () => {
  it("prefers the exact key over an earlier normalised match", () => {
    const def = tourDatesSwapping(CITY.fieldId, field("fld_a", "City"), field("fld_b", "city"));
    expect(findViewField(def.fields, "city", CITY)?.id).toBe("fld_b");
  });

  it("prefers the exact key even when its type is one the role can't render", () => {
    const def = tourDatesSwapping(CITY.fieldId, field("fld_a", "City"), field("fld_b", "city", "url"));
    expect(findViewField(def.fields, "city", CITY)?.id).toBe("fld_b");
    expect(checkFieldRequirement(def.fields, "city", CITY)).toBe("wrong-type");
  });

  it("prefers an accepted type over field order among inexact matches", () => {
    const def = tourDatesSwapping(
      CITY.fieldId,
      field("fld_a", "City", "url"),
      field("fld_b", "CITY"),
    );
    expect(findViewField(def.fields, "city", CITY)?.id).toBe("fld_b");
    expect(checkFieldRequirement(def.fields, "city", CITY)).toBe("ok");
  });

  it("falls back to field order when nothing else separates them", () => {
    const def = tourDatesSwapping(CITY.fieldId, field("fld_a", "City"), field("fld_b", "CITY"));
    expect(findViewField(def.fields, "city", CITY)?.id).toBe("fld_a");
  });

  it("always takes the declared id over any name match", () => {
    const def = { ...tourDatesCollectionDef, fields: [...tourDatesCollectionDef.fields, field("x", "city")] };
    expect(findViewField(def.fields, "city", CITY)?.id).toBe(CITY.fieldId);
  });
});

describe("viewFieldIdFor", () => {
  it("keeps a declared id that's still in the def", () => {
    expect(viewFieldIdFor(tourDatesCollectionDef, TOUR_DATES_FIELD_IDS.date)).toBe(
      TOUR_DATES_FIELD_IDS.date,
    );
  });

  it("resolves a deleted declared id to its same-name stand-in", () => {
    const def = tourDatesSwapping(TOUR_DATES_FIELD_IDS.date, field("fld_new_date", "Date", "date"));
    expect(viewFieldIdFor(def, TOUR_DATES_FIELD_IDS.date)).toBe("fld_new_date");
  });

  it("keeps the deleted id when the stand-in's type is one the role refuses", () => {
    // The card won't read a Short text "Release date", so the default
    // block's sort doesn't either.
    const releases = {
      ...releasesCollectionDef,
      fields: [
        ...releasesCollectionDef.fields.filter((f) => f.key !== "releaseDate"),
        field("fld_text_rel", "Release date", "text"),
      ],
    };
    const declared = VIEW_REQUIREMENTS.releases.fields.releaseDate.fieldId;
    expect(viewFieldIdFor(releases, declared)).toBe(declared);
  });

  it("keeps the deleted id when nothing stands in", () => {
    const def = tourDatesWith(TOUR_DATES_FIELD_IDS.date, null);
    expect(viewFieldIdFor(def, TOUR_DATES_FIELD_IDS.date)).toBe(TOUR_DATES_FIELD_IDS.date);
  });

  it("keeps the deleted status id: status doesn't match by name", () => {
    const def = tourDatesSwapping(STATUS.fieldId, field("fld_new_status", "status"));
    expect(viewFieldIdFor(def, STATUS.fieldId)).toBe(STATUS.fieldId);
  });

  it("leaves ids no view declares, and collections without a view, alone", () => {
    expect(viewFieldIdFor(tourDatesCollectionDef, "fld_whatever")).toBe("fld_whatever");
    expect(
      viewFieldIdFor({ slug: "store-items", fields: [field("x", "date", "date")] }, TOUR_DATES_FIELD_IDS.date),
    ).toBe(TOUR_DATES_FIELD_IDS.date);
  });

  it("resolves the posts and releases sort fields too", () => {
    const posts = {
      ...postsCollectionDef,
      fields: [
        ...postsCollectionDef.fields.filter((f) => f.key !== "publishedAt"),
        field("fld_new_pub", "published at", "date"),
      ],
    };
    const declared = VIEW_REQUIREMENTS.posts.fields.publishedAt.fieldId;
    expect(viewFieldIdFor(posts, declared)).toBe("fld_new_pub");
    const releases = {
      ...releasesCollectionDef,
      fields: [
        ...releasesCollectionDef.fields.filter((f) => f.key !== "releaseDate"),
        field("fld_new_rel", "Release Date", "date"),
      ],
    };
    expect(viewFieldIdFor(releases, VIEW_REQUIREMENTS.releases.fields.releaseDate.fieldId)).toBe(
      "fld_new_rel",
    );
  });
});

describe("renaming a same-name stand-in", () => {
  // Saved: city deleted and re-added as "city" under a new id. Draft:
  // that field renamed to "town".
  const SAVED = tourDatesSwapping(CITY.fieldId, field("fld_readded", "city"));
  const RENAMED = tourDatesSwapping(CITY.fieldId, field("fld_readded", "town"));

  it("reports the role missing because of the rename", () => {
    const [problem] = viewFieldProblems(RENAMED, SAVED);
    expect(problem?.status).toBe("missing");
    expect(problem?.missingCause).toEqual({
      kind: "renamed",
      field: field("fld_readded", "town"),
      savedKey: "city",
    });
  });

  it("says it was renamed, not removed, and how to undo it", () => {
    const [problem] = viewFieldProblems(RENAMED, SAVED);
    expect(describeViewFieldProblem(RENAMED, problem!)).toBe(
      'The city field was renamed to "town", so the city doesn\'t show on the public tour dates ' +
        'list. Name it "city" again to undo this.',
    );
  });

  it("names the saved key as typed, trimmed", () => {
    const saved = tourDatesSwapping(CITY.fieldId, field("fld_readded", " City "));
    const [problem] = viewFieldProblems(RENAMED, saved);
    expect(describeViewFieldProblem(RENAMED, problem!)).toMatch(/Name it "City" again to undo this\.$/);
  });

  it("says the field has no name while the artist has cleared it", () => {
    const cleared = tourDatesSwapping(CITY.fieldId, field("fld_readded", "  "));
    const [problem] = viewFieldProblems(cleared, SAVED);
    expect(describeViewFieldProblem(cleared, problem!)).toBe(
      "The city field has no name, so the city doesn't show on the public tour dates list. " +
        'Name it "city" again to undo this.',
    );
  });

  it("doesn't flag a rename that still matches the role", () => {
    const renamed = tourDatesSwapping(CITY.fieldId, field("fld_readded", "City"));
    expect(viewFieldProblems(renamed, SAVED)).toEqual([]);
  });

  it("doesn't flag renaming a declared field: it resolves by id", () => {
    const renamed = tourDatesWith(CITY.fieldId, field(CITY.fieldId, "town"));
    expect(viewFieldProblems(renamed, tourDatesCollectionDef)).toEqual([]);
  });

  it("keeps the no-way-back copy for status, whatever happened to it", () => {
    const [problem] = viewFieldProblems(tourDatesWith(STATUS.fieldId, null), tourDatesCollectionDef);
    expect(describeViewFieldProblem(tourDatesCollectionDef, problem!)).toBe(
      "The status field was removed, so tour dates lists that hide cancelled shows (the " +
        "default) ignore that filter, so cancelled shows are listed too.",
    );
  });
});

describe("viewFieldImpact — a same-name field waiting to take over", () => {
  // Declared ticketUrl renamed to "tickets" (it still holds the role by
  // id), and a new field named "ticketUrl" added.
  const DRAFT = {
    ...tourDatesCollectionDef,
    fields: [
      ...tourDatesCollectionDef.fields.map((f) => (f.id === TICKETS.fieldId ? { ...f, key: "tickets" } : f)),
      field("fld_new_tickets", "ticketUrl", "url"),
    ],
  };

  it("doesn't flag removing the declared field: the new one takes the role", () => {
    expect(viewFieldImpact(DRAFT, TICKETS.fieldId, { kind: "remove" })).toBeNull();
    const after = { ...DRAFT, fields: DRAFT.fields.filter((f) => f.id !== TICKETS.fieldId) };
    expect(findViewField(after.fields, "ticketUrl", TICKETS)?.id).toBe("fld_new_tickets");
  });

  it("doesn't flag a retype the waiting field covers", () => {
    // Two inexact stand-ins: retyping the first to URL hands the role to
    // the second, which the card can render.
    const standIns = tourDatesSwapping(
      CITY.fieldId,
      field("fld_a", "City"),
      field("fld_b", "CITY"),
    );
    expect(
      viewFieldImpact(standIns, "fld_a", { kind: "retype", from: "text", to: "url" }),
    ).toBeNull();
  });

  it("still flags removing the only field for the role", () => {
    expect(viewFieldImpact(tourDatesCollectionDef, TICKETS.fieldId, { kind: "remove" })).not.toBeNull();
  });

  it("flags a waiting field the role can't render", () => {
    const draft = {
      ...DRAFT,
      fields: DRAFT.fields.map((f) =>
        f.id === "fld_new_tickets" ? ({ ...f, type: "date" } as FieldDef) : f,
      ),
    };
    expect(viewFieldImpact(draft, TICKETS.fieldId, { kind: "remove" })).not.toBeNull();
  });
});
