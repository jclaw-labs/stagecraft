import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type { NextConfig } from "next";

/**
 * The `next.config` settings every musician site needs, as a wrapper the
 * artist-repo shell applies: `export default withStagecraft({})`
 * (ADR-016 §1). Keeping them in the package means a fix to them ships as
 * a package release rather than a change to every site's config.
 */

/**
 * The repo root to trace from when the app sits in the Stagecraft
 * monorepo, else undefined.
 *
 * In the monorepo, `apps/web` and `packages/*` share a root lockfile and
 * Next.js wants `outputFileTracingRoot` set so its dependency tracing
 * reaches the sibling packages. In a stand-alone artist repo that root
 * doesn't exist, and forcing `../..` would point above the repo, which
 * Next.js's tracer can't read. So: walk up two levels from the app and
 * check whether that `package.json` declares `workspaces`.
 *
 * The app root comes from `process.cwd()`, where Next.js runs, not from
 * this module's location: in an artist site this module sits under
 * `node_modules`.
 */
export function detectMonorepoRoot(appRoot: string = process.cwd()): string | undefined {
  const candidate = path.join(appRoot, "../..");
  const pkgPath = path.join(candidate, "package.json");
  if (!existsSync(pkgPath)) return undefined;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { workspaces?: unknown };
    return pkg.workspaces ? candidate : undefined;
  } catch {
    return undefined;
  }
}

type HeaderRules = Awaited<ReturnType<NonNullable<NextConfig["headers"]>>>;

/**
 * Response headers for uploaded images.
 *
 * SVG uploads are sanitised at write time via DOMPurify (see
 * `src/lib/svg-sanitise.ts`), but defense-in-depth: also set
 * `Content-Disposition: attachment` on the raw upload URL
 * (`/images/<slug>/<id>/original.svg`) so a direct top-level navigation
 * to the file triggers a download dialog instead of inline browser
 * rendering. This neutralises the SVG-as-document attack surface (script
 * execution in the artist's origin) entirely for non-image-tag requests.
 * Inline `<img src="...">` is unaffected — browsers ignore the
 * disposition for image subresource requests.
 *
 * Also pinned: `Content-Type: image/svg+xml` (so the response is
 * unambiguously SVG even if the host's MIME guess gets it wrong) and
 * `X-Content-Type-Options: nosniff` (browsers don't second-guess the
 * declared type, blocking MIME-sniff escalations to HTML).
 */
export const STAGECRAFT_HEADERS: HeaderRules = [
  {
    // Pattern matches the on-disk shape
    // `/images/<contentSlug>/<id>/original.svg`. Anything outside that
    // prefix (custom SVG paths under /public, future tenant-specific
    // layouts) keeps its default headers.
    source: "/images/:contentSlug/:id/original.svg",
    headers: [
      { key: "Content-Disposition", value: "attachment" },
      { key: "Content-Type", value: "image/svg+xml" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      // `no-transform` forbids intermediate proxies / CDNs from rewriting
      // the SVG bytes (some optimise by inlining as a data URI, stripping
      // XML declarations, or rewriting namespaces). The sanitiser has
      // already locked the content shape on the way in; allowing a CDN to
      // mutate it would re-open the surface we just closed.
      { key: "Cache-Control", value: "no-transform" },
    ],
  },
  {
    // ICO uploads (artist-uploaded favicons). No script-execution surface
    // — `<link rel="icon">` is the only standard render path — but pin
    // Content-Type + nosniff for defense-in-depth completeness.
    // Crucially: NO `Content-Disposition: attachment` here — that would
    // break the favicon use case (browsers fetch the icon inline; an
    // attachment prompt would trigger a download instead).
    source: "/images/:contentSlug/:id/original.ico",
    headers: [
      { key: "Content-Type", value: "image/vnd.microsoft.icon" },
      { key: "X-Content-Type-Options", value: "nosniff" },
    ],
  },
];

/**
 * `config` with the Stagecraft settings applied. The site's own
 * `headers()` rules follow the Stagecraft ones, and its `experimental`
 * flags are kept alongside `globalNotFound`.
 */
export function withStagecraft(config: NextConfig = {}, appRoot: string = process.cwd()): NextConfig {
  const monorepoRoot = detectMonorepoRoot(appRoot);
  const siteHeaders = config.headers;
  return {
    reactStrictMode: true,
    ...(monorepoRoot ? { outputFileTracingRoot: monorepoRoot } : {}),
    ...config,
    experimental: {
      ...config.experimental,
      /**
       * Serve unmatched URLs from `app/global-not-found.tsx`. A root
       * `app/not-found.tsx` would go into the RSC payload of every route,
       * admin included, and the public 404 renders the artist's theme
       * (#390). Experimental in Next 15.4+.
       */
      globalNotFound: true,
    },
    async headers() {
      return [...STAGECRAFT_HEADERS, ...((await siteHeaders?.()) ?? [])];
    },
  };
}
