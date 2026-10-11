import { describe, expect, it } from "vitest";

import {
  collectShellFiles,
  collectSiteFiles,
  SHELL_DIR,
  STARTER_CONTENT_DIR,
  TEMPLATE_DIR,
} from "../../../scripts/generate-template-bundle.mjs";
import { MUSICIAN_SITE_PACKAGE } from "../site-scaffold";
import { readTemplateFiles } from "../template-reader";

describe("readTemplateFiles", () => {
  it("serves the build-time bundle, matching the shell or the template and starter content on disk", async () => {
    // The bundle is regenerated before every test run (`npm run test`), so a
    // mismatch here means the generator and the walk disagree. It's the shell
    // when a release of the package is on npm's `latest`, and the full
    // template until then.
    const files = await readTemplateFiles();
    const pkg = JSON.parse(files.find((f) => f.path === "package.json")!.content);
    const pinned: string | undefined = pkg.dependencies?.[MUSICIAN_SITE_PACKAGE];
    expect(files).toEqual(
      pinned
        ? await collectShellFiles(SHELL_DIR, MUSICIAN_SITE_PACKAGE, pinned)
        : await collectSiteFiles(TEMPLATE_DIR, STARTER_CONTENT_DIR),
    );
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
