import { describe, expect, it } from "vitest";

import { TOUR_DATES_FIELD_IDS, VIDEOS_FIELD_IDS } from "../field-ids";
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
    expect(checkFieldRequirement(tourDatesCollectionDef.fields, CITY)).toBe("ok");
  });

  it("accepts a lossless retype the view can still render (text → longText)", () => {
    const def = tourDatesWith(CITY.fieldId, {
      id: CITY.fieldId,
      key: "city",
      type: "longText",
      required: true,
    });
    expect(checkFieldRequirement(def.fields, CITY)).toBe("ok");
  });

  it("is missing when the field was deleted", () => {
    expect(checkFieldRequirement(tourDatesWith(CITY.fieldId, null).fields, CITY)).toBe("missing");
  });

  it("is wrong-type when the field was retyped to something the view can't render", () => {
    const def = tourDatesWith(CITY.fieldId, {
      id: CITY.fieldId,
      key: "city",
      type: "number",
      required: true,
    });
    expect(checkFieldRequirement(def.fields, CITY)).toBe("wrong-type");
  });

  it("ignores renames — fields resolve by id, not key", () => {
    const def = tourDatesWith(CITY.fieldId, {
      id: CITY.fieldId,
      key: "town",
      type: "text",
      required: true,
    });
    expect(checkFieldRequirement(def.fields, CITY)).toBe("ok");
  });
});

// ---------------------------------------------------------------------------
// resolveViewFields — fallback decision + gated readers
// ---------------------------------------------------------------------------

describe("resolveViewFields", () => {
  it("returns null (→ default card) when a required field is missing", () => {
    expect(resolveViewFields(tourDatesWith(CITY.fieldId, null), "tour-dates")).toBeNull();
  });

  it("returns null when a required field has an incompatible type", () => {
    const videosWithEmbedAsImage: CollectionDef = {
      ...videosCollectionDef,
      fields: videosCollectionDef.fields.map((f) =>
        f.id === VIDEOS_FIELD_IDS.embedUrl ? { id: f.id, key: f.key, type: "image", required: true } : f,
      ),
    };
    expect(resolveViewFields(videosWithEmbedAsImage, "videos")).toBeNull();
    const retyped = tourDatesWith(CITY.fieldId, {
      id: CITY.fieldId,
      key: "city",
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

  it("reads images only from image values", () => {
    const fields = resolveViewFields(photosCollectionDef, "photos")!;
    const item: Item = { id: "p", slug: "p", ...TS, values: {} };
    expect(fields.image(item, "image")).toBeNull();
    expect(fields.image(item, "caption")).toBeNull();
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
      type: "number",
      required: true,
    });
    const withoutTickets = { ...def, fields: def.fields.filter((f) => f.id !== TICKETS.fieldId) };
    const problems = viewFieldProblems(withoutTickets);
    expect(problems.map((p) => [p.role, p.status, p.actualType])).toEqual([
      ["city", "wrong-type", "number"],
      ["ticketUrl", "missing", null],
    ]);
  });
});

// ---------------------------------------------------------------------------
// viewFieldImpact + copy
// ---------------------------------------------------------------------------

describe("viewFieldImpact", () => {
  it("flags removing a required field", () => {
    const impact = viewFieldImpact(tourDatesCollectionDef, CITY.fieldId, { kind: "remove" });
    expect(impact?.requirement).toBe(CITY);
    expect(impact?.viewLabel).toBe("tour dates list");
  });

  it("flags removing an optional field", () => {
    const impact = viewFieldImpact(tourDatesCollectionDef, TICKETS.fieldId, { kind: "remove" });
    expect(impact?.requirement.required).toBe(false);
  });

  it("flags a retype to a type the view can't render", () => {
    expect(
      viewFieldImpact(tourDatesCollectionDef, CITY.fieldId, { kind: "retype", to: "number" }),
    ).not.toBeNull();
  });

  it("allows a retype to another accepted type", () => {
    expect(
      viewFieldImpact(tourDatesCollectionDef, CITY.fieldId, { kind: "retype", to: "longText" }),
    ).toBeNull();
  });

  it("ignores fields the view doesn't read and collections without a view", () => {
    expect(
      viewFieldImpact(tourDatesCollectionDef, TOUR_DATES_FIELD_IDS.notes, { kind: "remove" }),
    ).toBeNull();
    expect(viewFieldImpact({ slug: "store-items" }, CITY.fieldId, { kind: "remove" })).toBeNull();
  });
});

describe("describeViewFieldImpact / describeViewFieldProblem", () => {
  it("explains the default-card fallback for a required field", () => {
    const impact = viewFieldImpact(tourDatesCollectionDef, CITY.fieldId, { kind: "remove" })!;
    expect(describeViewFieldImpact(impact, "city")).toBe(
      'Removing "city" means the public tour dates list will switch to the plain default card ' +
        "(its layout needs the city as Short text or Long text). Continue?",
    );
  });

  it("explains a hidden piece for an optional field, naming the new type on retype", () => {
    const impact = viewFieldImpact(tourDatesCollectionDef, TICKETS.fieldId, {
      kind: "retype",
      to: "number",
    })!;
    expect(describeViewFieldImpact(impact, "ticketUrl")).toBe(
      'Changing "ticketUrl" to Number means the ticket link will no longer show on the ' +
        "public tour dates list. Continue?",
    );
  });

  it("describes a standing problem in the present tense", () => {
    const def = tourDatesWith(CITY.fieldId, {
      id: CITY.fieldId,
      key: "city",
      type: "number",
      required: true,
    });
    const [problem] = viewFieldProblems(def);
    expect(describeViewFieldProblem(def, problem!)).toBe(
      "The city field is now Number, so the public tour dates list falls back to the plain " +
        "default card (its layout needs the city as Short text or Long text).",
    );
    const [removed] = viewFieldProblems(tourDatesWith(TICKETS.fieldId, null));
    expect(describeViewFieldProblem(tourDatesCollectionDef, removed!)).toBe(
      "The ticket link field was removed, so the ticket link doesn't show on the public tour dates list.",
    );
  });
});
