import { describe, expect, it } from "vitest";

import { PAGES_FIELD_IDS } from "@/lib/collections/field-ids";

import { saveErrorMessage } from "./save-error";

const FIELDS = [{ id: PAGES_FIELD_IDS.title, key: "title" }];

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

  it("appends the first issue, labelled by the field's key", () => {
    expect(
      saveErrorMessage(
        400,
        {
          ok: false,
          error: "Validation failed",
          issues: [
            { path: `values.${PAGES_FIELD_IDS.title}`, message: "Required" },
            { path: "values.other", message: "ignored" },
          ],
        },
        FIELDS,
      ),
    ).toBe("Validation failed: title: Required");
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
});
