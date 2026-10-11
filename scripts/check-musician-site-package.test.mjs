import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { minimalAppFiles } from "./check-musician-site-package.mjs";

describe("minimalAppFiles", () => {
  const files = minimalAppFiles({ templateTarball: "/p/t.tgz", upgradersTarball: "/p/u.tgz" });

  it("installs both tarballs next to the Next.js peers", () => {
    const pkg = JSON.parse(files["package.json"]);
    expect(pkg.dependencies).toMatchObject({
      "@jclaw-labs/musician-site": "file:/p/t.tgz",
      "@jclaw-labs/content-upgraders": "file:/p/u.tgz",
      next: "^15.5.27",
    });
  });

  it("takes the package's root layout and renders a client component", () => {
    expect(files["app/layout.tsx"]).toContain('from "@jclaw-labs/musician-site/app/layout"');
    expect(files["app/page.tsx"]).toContain('from "@jclaw-labs/musician-site/components/ContactForm"');
  });

  it("renders a module that resolves # and relative imports inside dist/", () => {
    // Header imports #components/Image.js (which imports #lib/image-types.js)
    // and #lib/site-config-types.js (which imports ./image-types.js).
    expect(files["app/page.tsx"]).toContain('from "@jclaw-labs/musician-site/components/Header"');
    expect(files["app/page.tsx"]).toMatch(/<Header\b/);
    const header = fs.readFileSync(new URL("../templates/musician-site/src/components/Header.tsx", import.meta.url), "utf8");
    expect(header).toMatch(/from "#components\/[^"]+\.js"/);
    expect(header).toMatch(/from "#lib\/[^"]+\.js"/);
  });

  it("uses a module that resolves #puck imports inside dist/", () => {
    expect(files["app/page.tsx"]).toContain(
      'import { resolveTemplate } from "@jclaw-labs/musician-site/lib/collections/template/renderer";',
    );
    expect(files["app/page.tsx"]).toContain("{typeof resolveTemplate}");
    const renderer = fs.readFileSync(
      new URL("../templates/musician-site/src/lib/collections/template/renderer.tsx", import.meta.url),
      "utf8",
    );
    expect(renderer).toMatch(/from "#puck\/[^"]+\.js"/);
  });
});
