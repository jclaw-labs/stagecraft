import { describe, expect, it } from "vitest";

import { GENERATED_HEADER, renderTemplateModule } from "../template-bundle";

/** Evaluate the generated module's payload the way the runtime would. */
function parseRendered(source: string): unknown {
  const m = source.match(/JSON\.parse\(("[^\n]*")\);/);
  if (!m) throw new Error("no JSON.parse payload in rendered module");
  return JSON.parse(JSON.parse(m[1]));
}

describe("renderTemplateModule", () => {
  it("round-trips the file list", () => {
    const files = [
      { path: "package.json", content: '{ "name": "musician-site" }\n' },
      { path: "src/app/page.tsx", content: "export default function Page() {}\n" },
    ];

    expect(parseRendered(renderTemplateModule(files))).toEqual(files);
  });

  it("preserves content that needs escaping", () => {
    const files = [
      { path: "weird.ts", content: 'const s = "quotes", t = `tick ${x}`;\n\\n </script>' },
    ];

    expect(parseRendered(renderTemplateModule(files))).toEqual(files);
  });

  it("handles an empty file list", () => {
    expect(parseRendered(renderTemplateModule([]))).toEqual([]);
  });

  it("starts with the generated-file header and exports the typed constant", () => {
    const source = renderTemplateModule([]);

    expect(source.startsWith(GENERATED_HEADER)).toBe(true);
    expect(source).toContain("export const MUSICIAN_SITE_TEMPLATE_FILES: TemplateFile[]");
  });
});
