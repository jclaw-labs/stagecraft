import { describe, expect, it } from "vitest";

import { PAGES_FIELD_IDS } from "./field-ids";
import { type ItemRouteFailureBody, saveErrorMessage } from "./save-error";

const FIELDS = [
  { id: PAGES_FIELD_IDS.title, key: "title" },
  { id: PAGES_FIELD_IDS.body, key: "body" },
];

/** A failure body as parsed off the wire, where `path` can be anything. */
function wireBody(issues: Array<{ path: unknown; message: unknown }>): ItemRouteFailureBody {
  return { ok: false, error: "Validation failed", issues } as unknown as ItemRouteFailureBody;
}

describe("saveErrorMessage", () => {
  it("falls back to the HTTP status when there's no body", () => {
    expect(saveErrorMessage(500, null)).toBe("Save failed (HTTP 500)");
  });

  it("falls back to the HTTP status when the body has no error", () => {
    expect(saveErrorMessage(502, { ok: false })).toBe("Save failed (HTTP 502)");
  });

  it("uses the route's error when there are no issues", () => {
    expect(saveErrorMessage(404, { ok: false, error: "Item not found" })).toBe("Item not found");
    expect(saveErrorMessage(400, { ok: false, error: "Bad", issues: [] })).toBe("Bad");
  });

  it("appends the issue, labelled by the field's key", () => {
    expect(
      saveErrorMessage(
        400,
        {
          ok: false,
          error: "Validation failed",
          issues: [{ path: `values.${PAGES_FIELD_IDS.title}`, message: "Required" }],
        },
        FIELDS,
      ),
    ).toBe("Validation failed: title: Required");
  });

  it("lists every issue, each labelled by its field", () => {
    expect(
      saveErrorMessage(
        400,
        {
          ok: false,
          error: "Validation failed",
          issues: [
            { path: `values.${PAGES_FIELD_IDS.title}`, message: "Required" },
            { path: `values.${PAGES_FIELD_IDS.body}.value`, message: "Invalid input" },
            { path: "", message: "Bad shape" },
          ],
        },
        FIELDS,
      ),
    ).toBe("Validation failed: title: Required; body: Invalid input; Bad shape");
  });

  it("labels a nested path by its field", () => {
    expect(
      saveErrorMessage(
        400,
        {
          ok: false,
          error: "Validation failed",
          issues: [{ path: `values.${PAGES_FIELD_IDS.title}.value`, message: "Too long" }],
        },
        FIELDS,
      ),
    ).toBe("Validation failed: title: Too long");
  });

  it("falls back to the raw path for an unknown field", () => {
    expect(
      saveErrorMessage(400, {
        ok: false,
        error: "Validation failed",
        issues: [{ path: "values.f_unknown", message: "Required" }],
      }),
    ).toBe("Validation failed: values.f_unknown: Required");
  });

  it("falls back to the raw path outside `values`", () => {
    expect(
      saveErrorMessage(
        400,
        { ok: false, error: "Validation failed", issues: [{ path: "createdAt", message: "Invalid" }] },
        FIELDS,
      ),
    ).toBe("Validation failed: createdAt: Invalid");
  });

  it("omits the label for an empty path", () => {
    expect(
      saveErrorMessage(400, {
        ok: false,
        error: "Validation failed",
        issues: [{ path: "", message: "Bad shape" }],
      }),
    ).toBe("Validation failed: Bad shape");
  });

  it("appends the issue to the HTTP fallback when the error is missing", () => {
    expect(
      saveErrorMessage(400, { ok: false, issues: [{ path: "", message: "Bad shape" }] }),
    ).toBe("Save failed (HTTP 400): Bad shape");
  });

  describe("a path that isn't a string", () => {
    it("joins an array path and labels it by its field", () => {
      expect(
        saveErrorMessage(
          400,
          wireBody([{ path: ["values", PAGES_FIELD_IDS.title, "value"], message: "Required" }]),
          FIELDS,
        ),
      ).toBe("Validation failed: title: Required");
    });

    it("joins numeric segments of an array path", () => {
      expect(
        saveErrorMessage(400, wireBody([{ path: ["values", "f_list", 0], message: "Bad" }])),
      ).toBe("Validation failed: values.f_list.0: Bad");
    });

    it.each([
      ["a number", 5],
      ["null", null],
      ["an object", { values: "x" }],
      ["undefined", undefined],
    ])("ignores %s and keeps the message", (_label, path) => {
      expect(saveErrorMessage(400, wireBody([{ path, message: "Required" }]), FIELDS)).toBe(
        "Validation failed: Required",
      );
    });
  });

  it("skips issues without a usable message", () => {
    expect(
      saveErrorMessage(
        400,
        wireBody([
          { path: "values.x", message: 7 },
          { path: "values.y", message: "" },
          { path: "", message: "Kept" },
        ]),
      ),
    ).toBe("Validation failed: Kept");
  });

  it("ignores an `issues` field that isn't an array", () => {
    const body = { ok: false, error: "Validation failed", issues: "nope" } as unknown as ItemRouteFailureBody;
    expect(saveErrorMessage(400, body)).toBe("Validation failed");
  });
});
