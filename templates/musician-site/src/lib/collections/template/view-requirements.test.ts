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
  isSpecialisedViewSlug,
  resolveViewFields,
  SPECIALISED_VIEW_SLUGS,
  VIEW_REQUIREMENTS,
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

  it("warns that removing tour-date status empties lists that hide cancelled shows", () => {
    // The default tour-dates block filters `status notEquals cancelled`; a
    // removed field fails that clause for every item.
    const impact = viewFieldImpact(tourDatesCollectionDef, TOUR_DATES_FIELD_IDS.status, {
      kind: "remove",
    })!;
    expect(describeViewFieldImpact(impact, "status")).toBe(
      'Removing "status" means tour dates lists that hide cancelled shows (the default) will ' +
        'hide every show. Adding a new "status" field later won\'t undo this. Continue?',
    );
    const [problem] = viewFieldProblems(tourDatesWith(TOUR_DATES_FIELD_IDS.status, null));
    expect(describeViewFieldProblem(tourDatesCollectionDef, problem!)).toBe(
      "The status field was removed, so tour dates lists that hide cancelled shows (the " +
        "default) hide every show.",
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
    const [removed] = viewFieldProblems(tourDatesWith(TICKETS.fieldId, null));
    expect(describeViewFieldProblem(tourDatesCollectionDef, removed!)).toBe(
      "The ticket link field was removed, so the ticket link doesn't show on the public tour dates list.",
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
