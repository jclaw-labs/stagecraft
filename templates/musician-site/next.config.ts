import type { NextConfig } from "next";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * When this template lives inside the Stagecraft monorepo, `apps/web` and
 * `packages/*` share a root lockfile and Next.js wants
 * `outputFileTracingRoot` set so its dependency tracing reaches the
 * sibling packages. When the template is pushed to a stand-alone artist
 * repo, that root doesn't exist — and forcing `../..` would point at a
 * directory above the repo, which Next.js's tracer can't read.
 *
 * Auto-detect: walk up two levels and check whether the parent
 * `package.json` declares `workspaces`. If yes, we're in the monorepo;
 * set the root. Otherwise the template is stand-alone and Next.js's
 * default (the closest lockfile to the project) is correct.
 */
function detectMonorepoRoot(): string | undefined {
  const candidate = path.join(import.meta.dirname, "../..");
  const pkgPath = path.join(candidate, "package.json");
  if (!existsSync(pkgPath)) return undefined;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { workspaces?: unknown };
    return pkg.workspaces ? candidate : undefined;
  } catch {
    return undefined;
  }
}

const monorepoRoot = detectMonorepoRoot();

const config: NextConfig = {
  reactStrictMode: true,
  ...(monorepoRoot ? { outputFileTracingRoot: monorepoRoot } : {}),
  /**
   * Response headers applied to specific static paths.
   *
   * SVG uploads are sanitised at write time via DOMPurify (see
   * `src/lib/svg-sanitise.ts`), but defense-in-depth: also set
   * `Content-Disposition: attachment` on the raw upload URL
   * (`/images/<slug>/<id>/original.svg`) so a direct top-level
   * navigation to the file triggers a download dialog instead of
   * inline browser rendering. This neutralises the SVG-as-document
   * attack surface (script execution in the artist's origin)
   * entirely for non-image-tag requests. Inline `<img src="...">`
   * is unaffected — browsers ignore the disposition for image
   * subresource requests.
   *
   * Also pinned: `Content-Type: image/svg+xml` (so the response
   * is unambiguously SVG even if the host's MIME guess gets it
   * wrong) and `X-Content-Type-Options: nosniff` (browsers don't
   * second-guess the declared type, blocking MIME-sniff escalations
   * to HTML).
   */
  async headers() {
    return [
      {
        // Pattern matches the on-disk shape
        // `/images/<contentSlug>/<id>/original.svg`. Anything
        // outside that prefix (custom SVG paths under /public,
        // future tenant-specific layouts) keeps its default
        // headers.
        source: "/images/:contentSlug/:id/original.svg",
        headers: [
          { key: "Content-Disposition", value: "attachment" },
          { key: "Content-Type", value: "image/svg+xml" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
      {
        // ICO uploads (artist-uploaded favicons). No script-execution
        // surface — `<link rel="icon">` is the only standard render
        // path — but pin Content-Type + nosniff for defense-in-depth
        // completeness. Crucially: NO `Content-Disposition:
        // attachment` here — that would break the favicon use case
        // (browsers fetch the icon inline; an attachment prompt
        // would trigger a download instead).
        source: "/images/:contentSlug/:id/original.ico",
        headers: [
          { key: "Content-Type", value: "image/vnd.microsoft.icon" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
  },
};

export default config;
