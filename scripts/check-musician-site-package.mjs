#!/usr/bin/env node
// @ts-check
/**
 * check-musician-site-package.mjs — the pack-and-build check for
 * `@jclaw-labs/musician-site` (ADR-016 §2).
 *
 * Packs both packages with `pack-musician-site.mjs`, installs the
 * tarballs into a minimal Next.js app **without a lockfile** (what
 * Netlify and Vercel do for a site repo), and runs `next build`. The app
 * takes the package's root layout, which imports the global stylesheet
 * from `node_modules`, and renders a client component (one that uses
 * state) from a server page, so a dropped `"use client"` fails the build.
 * The page also renders `Header`, which reaches `#components/…`,
 * `#lib/…` and a relative `.js` import inside `dist/`, and uses the
 * template renderer, which reaches `#puck/…`, so a broken `imports`
 * target or compiled specifier fails the build too.
 * Then it runs `stagecraft-site --help` from the installed tarball under
 * plain `node`.
 *
 * Usage (from the repo root, after `npm ci` at the root and in
 * templates/musician-site):
 *   node scripts/check-musician-site-package.mjs [--keep]
 *
 * `--keep` leaves the app directory in place and prints its path.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { packMusicianSite } from "./pack-musician-site.mjs";

/** The minimal app's files, keyed by path. */
export function minimalAppFiles({ templateTarball, upgradersTarball }) {
  const packageJson = {
    name: "musician-site-package-check",
    private: true,
    type: "module",
    scripts: { build: "next build" },
    dependencies: {
      "@jclaw-labs/content-upgraders": `file:${upgradersTarball}`,
      "@jclaw-labs/musician-site": `file:${templateTarball}`,
      next: "^15.5.27",
      react: "^19.0.0",
      "react-dom": "^19.0.0",
    },
    devDependencies: {
      "@types/node": "^22.0.0",
      "@types/react": "^19.0.0",
      "@types/react-dom": "^19.0.0",
      typescript: "^5.7.0",
    },
  };
  const tsconfig = {
    compilerOptions: {
      target: "ES2022",
      lib: ["dom", "dom.iterable", "esnext"],
      skipLibCheck: false,
      strict: true,
      noEmit: true,
      module: "esnext",
      moduleResolution: "bundler",
      resolveJsonModule: true,
      isolatedModules: true,
      jsx: "preserve",
      esModuleInterop: true,
      plugins: [{ name: "next" }],
    },
    include: ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
    exclude: ["node_modules"],
  };
  return {
    "package.json": JSON.stringify(packageJson, null, 2) + "\n",
    "tsconfig.json": JSON.stringify(tsconfig, null, 2) + "\n",
    "app/layout.tsx": 'export { default, metadata } from "@jclaw-labs/musician-site/app/layout";\n',
    "app/page.tsx": [
      'import { ContactForm } from "@jclaw-labs/musician-site/components/ContactForm";',
      'import { Header } from "@jclaw-labs/musician-site/components/Header";',
      'import { resolveTemplate } from "@jclaw-labs/musician-site/lib/collections/template/renderer";',
      'import { DEFAULT_HEADER_CONFIG } from "@jclaw-labs/musician-site/lib/site-config-types";',
      "",
      "export default function Page() {",
      "  return (",
      "    <>",
      '      <Header artistName="Check" header={DEFAULT_HEADER_CONFIG} navItems={[]} pageTitleBySlug={new Map()} />',
      "      <ContactForm />",
      "      <p hidden>{typeof resolveTemplate}</p>",
      "    </>",
      "  );",
      "}",
      "",
    ].join("\n"),
  };
}

/** @param {string} cmd @param {string[]} args @param {string} cwd */
function run(cmd, args, cwd) {
  return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
}

export function checkMusicianSitePackage({ keep = false } = {}) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "musician-site-check-"));
  try {
    const { template, upgraders } = packMusicianSite({ outDir: path.join(work, "pack") });
    const app = path.join(work, "app");
    for (const [file, content] of Object.entries(
      minimalAppFiles({ templateTarball: template, upgradersTarball: upgraders }),
    )) {
      fs.mkdirSync(path.dirname(path.join(app, file)), { recursive: true });
      fs.writeFileSync(path.join(app, file), content);
    }

    console.log("Installing the tarballs into a minimal Next.js app, with no lockfile…");
    run("npm", ["install", "--no-package-lock", "--no-audit", "--no-fund"], app);
    if (fs.existsSync(path.join(app, "package-lock.json"))) throw new Error("npm wrote a lockfile");

    console.log("Running next build…");
    process.stdout.write(run("npx", ["--no-install", "next", "build"], app));

    console.log("Running stagecraft-site --help under plain node…");
    const bin = fs.realpathSync(path.join(app, "node_modules/.bin/stagecraft-site"));
    const help = run(process.execPath, [bin, "--help"], app);
    if (!help.startsWith("Usage: stagecraft-site")) throw new Error(`Unexpected --help output:\n${help}`);
    process.stdout.write(help);
    console.log(keep ? `Done. App kept at ${app}` : "Done.");
  } finally {
    if (!keep) fs.rmSync(work, { recursive: true, force: true });
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) checkMusicianSitePackage({ keep: process.argv.includes("--keep") });
