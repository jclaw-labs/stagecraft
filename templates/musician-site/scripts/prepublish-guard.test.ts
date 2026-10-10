import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { publishProblems } from "./prepublish-guard.mjs";

describe("publishProblems", () => {
  it("accepts a package.json with registry deps and no source conditions", () => {
    expect(
      publishProblems({
        dependencies: { "@jclaw-labs/content-upgraders": "1.0.0", zod: "4.4.2" },
        imports: { "#lib/*": { default: "./dist/lib/*" }, "#plain": "./dist/plain.js" },
      }),
    ).toEqual([]);
  });

  it("accepts a package.json with neither field", () => {
    expect(publishProblems({})).toEqual([]);
  });

  it("flags a file: dependency", () => {
    expect(publishProblems({ dependencies: { a: "file:../a", b: "1.0.0" } })).toEqual(["dependency a is file:../a"]);
  });

  it("flags an imports target with a source condition", () => {
    expect(publishProblems({ imports: { "#lib/*": { source: "./src/lib/*", default: "./dist/lib/*" } } })).toEqual([
      "imports #lib/* has a source condition",
    ]);
  });

  it("refuses this directory's own package.json, which npm publish would run it on", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "../package.json"), "utf8"));
    expect(pkg.scripts.prepublishOnly).toBe("node scripts/prepublish-guard.mjs");
    expect(publishProblems(pkg)).toEqual(
      expect.arrayContaining([
        "dependency @jclaw-labs/content-upgraders is file:../../packages/content-upgraders",
        "imports #lib/* has a source condition",
      ]),
    );
  });
});
