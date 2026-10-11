import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, it, expect } from "vitest";

import {
  buildSiteScaffoldFiles,
  buildDependabotAutoMergeWorkflow,
  buildTemplateStamp,
  codePathManifest,
  gitBlobSha,
  MUSICIAN_SITE_PACKAGE,
  packageVersionFromFiles,
  templateVersionFromFiles,
  SITE_DEPENDENCY_COOLDOWN_DAYS,
  SITE_DEPENDABOT_PATH,
  SITE_MAJOR_UPDATES_IGNORED,
  TEMPLATE_STAMP_PATH,
} from "../site-scaffold";

const SHELL_PACKAGE_JSON = JSON.stringify({
  name: "musician-site",
  version: "0.0.1",
  dependencies: { [MUSICIAN_SITE_PACKAGE]: "1.4.2", next: "^15.5.27" },
});

const SHELL_FILES = [
  { path: "package.json", content: SHELL_PACKAGE_JSON },
  { path: "next.config.ts", content: "export default 1;\n" },
  { path: "src/app/layout.tsx", content: "layout" },
  { path: "src/content/collections/pages/items/home.json", content: "{}" },
  { path: "public/images/a/meta.json", content: "{}" },
];

describe("buildSiteScaffoldFiles", () => {
  it("emits the Dependabot config and template stamp, in order", () => {
    const files = buildSiteScaffoldFiles({ template: "musician-site", files: SHELL_FILES });
    expect(files.map((f) => f.path)).toEqual([SITE_DEPENDABOT_PATH, TEMPLATE_STAMP_PATH]);
  });

  it("pins the npm ecosystem and the cooldown in the Dependabot config", () => {
    const [dependabot] = buildSiteScaffoldFiles({ template: "musician-site", files: SHELL_FILES });
    expect(dependabot.content).toContain("version: 2");
    expect(dependabot.content).toContain('package-ecosystem: "npm"');
    expect(dependabot.content).toContain('directory: "/"');
    expect(dependabot.content).toContain(`default-days: ${SITE_DEPENDENCY_COOLDOWN_DAYS}`);
  });

  it("exempts the package from the cooldown and ignores majors of the package and the framework", () => {
    const [dependabot] = buildSiteScaffoldFiles({ template: "musician-site", files: SHELL_FILES });
    expect(dependabot.content).toContain(`    cooldown:
      default-days: ${SITE_DEPENDENCY_COOLDOWN_DAYS}
      exclude:
        - "${MUSICIAN_SITE_PACKAGE}"
    ignore:
`);
    expect([...SITE_MAJOR_UPDATES_IGNORED]).toEqual([MUSICIAN_SITE_PACKAGE, "next", "react", "react-dom"]);
    for (const name of SITE_MAJOR_UPDATES_IGNORED) {
      expect(dependabot.content).toContain(`      - dependency-name: "${name}"
        update-types: ["version-update:semver-major"]
`);
    }
    // Only majors are ignored: patch and minor updates still reach the auto-merge gate.
    expect(dependabot.content).not.toMatch(/semver-(?:minor|patch)/);
  });

  it("writes the stamp as pretty-printed JSON with a trailing newline", () => {
    const createdAt = new Date("2026-05-24T12:00:00.000Z");
    const stamp = buildSiteScaffoldFiles({ template: "musician-site", files: SHELL_FILES, createdAt }).find(
      (f) => f.path === TEMPLATE_STAMP_PATH,
    )!;
    expect(stamp.content).toBe(
      JSON.stringify(buildTemplateStamp({ template: "musician-site", files: SHELL_FILES, createdAt }), null, 2) + "\n",
    );
  });
});

describe("buildTemplateStamp", () => {
  const createdAt = new Date("2026-05-24T12:00:00.000Z");

  it("records the template, versions, manifest and an ISO createdAt for a shell site", () => {
    expect(buildTemplateStamp({ template: "musician-site", files: SHELL_FILES, createdAt })).toEqual({
      template: "musician-site",
      templateVersion: "0.0.1",
      packageVersion: "1.4.2",
      manifest: {
        "next.config.ts": gitBlobSha("export default 1;\n"),
        "package.json": gitBlobSha(SHELL_PACKAGE_JSON),
        "src/app/layout.tsx": gitBlobSha("layout"),
      },
      createdAt: "2026-05-24T12:00:00.000Z",
    });
  });

  it("records a null packageVersion for a full copy of the template", () => {
    const stamp = buildTemplateStamp({
      template: "musician-site",
      files: [{ path: "package.json", content: JSON.stringify({ name: "musician-site", version: "1.0.0-rc.0" }) }],
      createdAt,
    });
    expect(stamp.templateVersion).toBe("1.0.0-rc.0");
    expect(stamp.packageVersion).toBeNull();
    expect(Object.keys(stamp.manifest)).toEqual(["package.json"]);
  });

  it("defaults createdAt to now", () => {
    const before = Date.now();
    const stamp = buildTemplateStamp({ template: "musician-site", files: [] });
    expect(Date.parse(stamp.createdAt)).toBeGreaterThanOrEqual(before);
    expect(stamp.templateVersion).toBe("unknown");
    expect(stamp.manifest).toEqual({});
  });
});

describe("gitBlobSha", () => {
  it("matches git's blob hash, including for multi-byte UTF-8", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "blob-sha-"));
    try {
      for (const content of ["", "hello\n", "café — ♪\n"]) {
        const file = path.join(dir, "f");
        fs.writeFileSync(file, content, "utf8");
        const expected = execFileSync("git", ["hash-object", file], { encoding: "utf8" }).trim();
        expect(gitBlobSha(content)).toBe(expected);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("is git's well-known hash of the empty blob", () => {
    expect(gitBlobSha("")).toBe("e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
  });
});
describe("buildDependabotAutoMergeWorkflow", () => {
  it("gates on a build and limits auto-merge to patch/minor Dependabot PRs", () => {
    const content = buildDependabotAutoMergeWorkflow();
    expect(content).toContain("github.event.pull_request.user.login == 'dependabot[bot]'");
    expect(content).toContain("npm run build");
    expect(content).toContain("version-update:semver-patch");
    expect(content).toContain("version-update:semver-minor");
    expect(content).toContain("gh pr merge --squash");
    // Majors are intentionally not matched.
    expect(content).not.toContain("semver-major");
    // The Actions-expression escaping survived the template literal.
    expect(content).toContain("${{ secrets.GITHUB_TOKEN }}");
  });
});

describe("codePathManifest", () => {
  it("leaves out the artist's content and images, and sorts by path", () => {
    expect(
      Object.keys(
        codePathManifest([
          { path: "src/lib/b.ts", content: "b" },
          { path: "src/content/site.json", content: "{}" },
          { path: "public/images/x/meta.json", content: "{}" },
          { path: "src/contentish.ts", content: "ours" },
          { path: "vendor/content-upgraders/src/index.ts", content: "v" },
          { path: ".gitignore", content: "node_modules" },
        ]),
      ),
    ).toEqual([".gitignore", "src/contentish.ts", "src/lib/b.ts", "vendor/content-upgraders/src/index.ts"]);
  });
});

describe("packageVersionFromFiles", () => {
  const withDeps = (dependencies: Record<string, string>) => [
    { path: "package.json", content: JSON.stringify({ dependencies }) },
  ];

  it("reads the exact package version a shell depends on", () => {
    expect(packageVersionFromFiles(withDeps({ [MUSICIAN_SITE_PACKAGE]: "2.0.1" }))).toBe("2.0.1");
    expect(packageVersionFromFiles(withDeps({ [MUSICIAN_SITE_PACKAGE]: "2.1.0-rc.3" }))).toBe("2.1.0-rc.3");
  });

  it("is null for a range, a file: spec, or no dependency on the package", () => {
    expect(packageVersionFromFiles(withDeps({ [MUSICIAN_SITE_PACKAGE]: "^2.0.1" }))).toBeNull();
    expect(packageVersionFromFiles(withDeps({ [MUSICIAN_SITE_PACKAGE]: "file:../musician-site" }))).toBeNull();
    expect(packageVersionFromFiles(withDeps({ next: "15.5.27" }))).toBeNull();
    expect(packageVersionFromFiles([{ path: "package.json", content: "{}" }])).toBeNull();
  });

  it("is null when package.json is absent or unparseable", () => {
    expect(packageVersionFromFiles([])).toBeNull();
    expect(packageVersionFromFiles([{ path: "package.json", content: "{ not json" }])).toBeNull();
  });

  it("names the package the template publishes", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, "../../../../../templates/musician-site/package.json"), "utf8"),
    );
    expect(MUSICIAN_SITE_PACKAGE).toBe(pkg.name);
  });
});

describe("templateVersionFromFiles", () => {
  it("reads version from the template package.json", () => {
    expect(
      templateVersionFromFiles([
        { path: "package.json", content: JSON.stringify({ name: "musician-site", version: "2.4.0" }) },
        { path: "src/index.ts", content: "" },
      ]),
    ).toBe("2.4.0");
  });

  it("falls back to 'unknown' when package.json is absent", () => {
    expect(templateVersionFromFiles([{ path: "README.md", content: "# hi" }])).toBe("unknown");
  });

  it("falls back to 'unknown' when package.json is unparseable", () => {
    expect(templateVersionFromFiles([{ path: "package.json", content: "{ not json" }])).toBe(
      "unknown",
    );
  });

  it("falls back to 'unknown' when the version field is missing", () => {
    expect(
      templateVersionFromFiles([{ path: "package.json", content: JSON.stringify({ name: "x" }) }]),
    ).toBe("unknown");
  });
});
