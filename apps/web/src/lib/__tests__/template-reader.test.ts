import { describe, expect, it } from "vitest";

import { collectTemplateFiles, TEMPLATE_DIR } from "../../../scripts/generate-template-bundle.mjs";
import { readTemplateFiles } from "../template-reader";

describe("readTemplateFiles", () => {
  it("serves the build-time bundle, matching the template on disk", async () => {
    // The bundle is regenerated before every test run (`npm run test`), so a
    // mismatch here means the generator and the template walk disagree.
    expect(await readTemplateFiles()).toEqual(await collectTemplateFiles(TEMPLATE_DIR));
  });

  it("includes the template's package.json and excludes skipped paths", async () => {
    const paths = (await readTemplateFiles()).map((f) => f.path);

    expect(paths).toContain("package.json");
    expect(paths).not.toContain("CLAUDE.md");
    expect(paths).not.toContain("package-lock.json");
    expect(paths.some((p) => p.startsWith("scripts/") || p.includes("/node_modules/"))).toBe(false);
  });

  it("returns a fresh copy so callers can't mutate the shared bundle", async () => {
    const first = await readTemplateFiles();
    first[0].content = "mutated";
    first.pop();

    const second = await readTemplateFiles();
    expect(second[0].content).not.toBe("mutated");
    expect(second.length).toBe(first.length + 1);
  });
});
