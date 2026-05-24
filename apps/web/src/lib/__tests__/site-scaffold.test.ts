import { describe, it, expect } from "vitest";

import {
  buildSiteScaffoldFiles,
  templateVersionFromFiles,
  SITE_DEPENDENCY_COOLDOWN_DAYS,
  SITE_DEPENDABOT_PATH,
  TEMPLATE_STAMP_PATH,
} from "../site-scaffold";

describe("buildSiteScaffoldFiles", () => {
  it("emits the Dependabot config and template stamp, in order", () => {
    const files = buildSiteScaffoldFiles({
      template: "musician-site",
      templateVersion: "0.0.1",
    });
    expect(files.map((f) => f.path)).toEqual([SITE_DEPENDABOT_PATH, TEMPLATE_STAMP_PATH]);
  });

  it("pins the npm ecosystem and the cooldown in the Dependabot config", () => {
    const [dependabot] = buildSiteScaffoldFiles({
      template: "musician-site",
      templateVersion: "0.0.1",
    });
    expect(dependabot.content).toContain("version: 2");
    expect(dependabot.content).toContain('package-ecosystem: "npm"');
    expect(dependabot.content).toContain('directory: "/"');
    expect(dependabot.content).toContain(`default-days: ${SITE_DEPENDENCY_COOLDOWN_DAYS}`);
  });

  it("records template, version, and an ISO createdAt in the stamp", () => {
    const createdAt = new Date("2026-05-24T12:00:00.000Z");
    const stamp = buildSiteScaffoldFiles({
      template: "musician-site-legacy",
      templateVersion: "1.2.3",
      createdAt,
    }).find((f) => f.path === TEMPLATE_STAMP_PATH);
    expect(stamp).toBeDefined();
    expect(JSON.parse(stamp!.content)).toEqual({
      template: "musician-site-legacy",
      templateVersion: "1.2.3",
      createdAt: "2026-05-24T12:00:00.000Z",
    });
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
