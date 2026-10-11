import { describe, expect, it } from "vitest";

import { addedEntries, changesPackageSource, checkChangelog, unreleasedEntries } from "./check-changelog.mjs";

const changelog = (unreleased, released = ["- minor: Old feature."]) =>
  ["# Changelog", "", "Intro text.", "", "## Unreleased", "", ...unreleased, "", "## 1.0.0", "", ...released, ""].join("\n");

describe("changesPackageSource", () => {
  it("counts shipped files under the package source", () => {
    expect(changesPackageSource(["templates/musician-site/src/lib/a.ts"])).toBe(true);
    expect(changesPackageSource(["README.md", "templates/musician-site/src/app/globals.css"])).toBe(true);
  });

  it("ignores tests, snapshots and anything outside src/", () => {
    expect(
      changesPackageSource([
        "templates/musician-site/src/lib/a.test.ts",
        "templates/musician-site/src/components/B.test.tsx",
        "templates/musician-site/src/lib/c.spec.mjs",
        "templates/musician-site/src/lib/__snapshots__/a.test.ts.snap",
        "templates/musician-site/package.json",
        "templates/musician-site/e2e/x.spec.ts",
        "templates/musician-site-shell/src/app/layout.tsx",
        "apps/web/src/lib/x.ts",
      ]),
    ).toBe(false);
  });
});

describe("unreleasedEntries", () => {
  it("reads only well-formed entries under ## Unreleased", () => {
    const text = changelog(["- patch: Fix a.", "- Minor: wrong case", "- tweak: unknown level", "-patch: no space", "  - major: Indented."]);
    expect(unreleasedEntries(text)).toEqual(["- patch: Fix a.", "- major: Indented."]);
  });

  it("is empty without an Unreleased section", () => {
    expect(unreleasedEntries("# Changelog\n\n## 1.0.0\n\n- patch: Released.\n")).toEqual([]);
    expect(unreleasedEntries("")).toEqual([]);
  });

  it("rejects an entry with no text after the level", () => {
    expect(unreleasedEntries(changelog(["- patch:", "- minor: "]))).toEqual([]);
  });
});

describe("addedEntries", () => {
  it("lists the head's new entries with their levels", () => {
    expect(addedEntries(changelog(["- patch: Fix a."]), changelog(["- patch: Fix a.", "- minor: Add b."]))).toEqual([
      { level: "minor", line: "- minor: Add b." },
    ]);
  });

  it("counts a repeated line as new", () => {
    expect(addedEntries(changelog(["- patch: Same."]), changelog(["- patch: Same.", "- patch: Same."]))).toHaveLength(1);
  });

  it("ignores lines added to a released section", () => {
    expect(addedEntries(changelog([]), changelog([], ["- minor: Old feature.", "- major: Sneaked in."]))).toEqual([]);
  });

  it("treats a missing base changelog as empty", () => {
    expect(addedEntries("", changelog(["- major: Breaking."]))).toEqual([{ level: "major", line: "- major: Breaking." }]);
  });
});

describe("checkChangelog", () => {
  const files = ["templates/musician-site/src/lib/a.ts"];

  it("passes without an entry when the source didn't change", () => {
    expect(checkChangelog({ files: ["docs/x.md"], baseChangelog: "", headChangelog: "" }).ok).toBe(true);
  });

  it("passes when a source change adds an entry", () => {
    const result = checkChangelog({ files, baseChangelog: changelog([]), headChangelog: changelog(["- patch: Fix a."]) });
    expect(result).toEqual({ ok: true, message: "Changelog entries added: patch." });
  });

  it("fails when a source change adds no entry", () => {
    const result = checkChangelog({ files, baseChangelog: changelog(["- patch: Fix a."]), headChangelog: changelog(["- patch: Fix a."]) });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/adds no entry under "## Unreleased"/);
  });

  it("fails when the only new line has no level", () => {
    const result = checkChangelog({ files, baseChangelog: changelog([]), headChangelog: changelog(["- Fixed a."]) });
    expect(result.ok).toBe(false);
  });
});
