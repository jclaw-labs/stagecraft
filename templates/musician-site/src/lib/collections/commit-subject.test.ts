import { describe, expect, it } from "vitest";

import { itemCommitSubject, renameCommitSubject } from "./commit-subject";

describe("itemCommitSubject", () => {
  it.each([
    ["create", "Create page about"],
    ["update", "Update page about"],
    ["delete", "Delete page about"],
  ] as const)("names a page by its slug (%s)", (action, expected) => {
    expect(itemCommitSubject(action, "pages", "about")).toBe(expected);
  });

  it.each([
    ["create", "Create tour-dates/first-show"],
    ["update", "Update tour-dates/first-show"],
    ["delete", "Delete tour-dates/first-show"],
  ] as const)("uses collection/item for other collections (%s)", (action, expected) => {
    expect(itemCommitSubject(action, "tour-dates", "first-show")).toBe(expected);
  });
});

describe("renameCommitSubject", () => {
  it("names a page rename by its slugs", () => {
    expect(renameCommitSubject("pages", "about", "bio")).toBe("Rename page about → bio");
  });

  it("uses collection/item for other collections", () => {
    expect(renameCommitSubject("posts", "a", "b")).toBe("Rename posts/a → b");
  });
});
