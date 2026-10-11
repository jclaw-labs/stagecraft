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

/** The package's npm name, as an artist repo's shell depends on it. */
export const PACKAGE_NAME = "@jclaw-labs/musician-site";

/**
 * The oldest artist-repo shell this release of the package works with
 * (ADR-016 §3). The shell records its own in its package.json, as
 * `stagecraft.shellVersion`. Raise this, in a major release, whenever
 * the shell has to change: a new or renamed shell file, a changed
 * export, or a new literal route config or middleware matcher.
 */
export const REQUIRED_SHELL_VERSION = 1;

/**
 * Why the app at `appRoot` can't build with this release of the package,
 * or null when it can.
 *
 * Only an artist-repo shell is checked: an app whose package.json
 * depends on the package. A site that is a full copy of the template,
 * and the template itself, have no shell to check. A shell older than
 * `REQUIRED_SHELL_VERSION`, or one without a version, fails, so a
 * package release that needs a new shell fails the site's build (and the
 * Dependabot auto-merge gate) rather than the live site.
 */
export function shellVersionError(appRoot: string = process.cwd()): string | null {
  let pkg: { dependencies?: Record<string, unknown>; stagecraft?: { shellVersion?: unknown } };
  try {
    pkg = JSON.parse(readFileSync(path.join(appRoot, "package.json"), "utf8"));
  } catch {
    return null;
  }
  if (!pkg.dependencies?.[PACKAGE_NAME]) return null;
  const version = pkg.stagecraft?.shellVersion;
  const upgrade =
    "Merge the site's Stagecraft upgrade pull request, which updates the shell and the package together.";
  if (typeof version !== "number" || !Number.isInteger(version)) {
    return (
      `This site's package.json has no stagecraft.shellVersion, and ${PACKAGE_NAME} needs ` +
      `shell version ${REQUIRED_SHELL_VERSION} or later. ${upgrade}`
    );
  }
  if (version < REQUIRED_SHELL_VERSION) {
    return (
      `This site's shell is version ${version} (stagecraft.shellVersion in package.json), but ` +
      `${PACKAGE_NAME} needs shell version ${REQUIRED_SHELL_VERSION} or later. ${upgrade}`
    );
  }
  return null;
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
 *
 * Throws when the site's shell is too old for this release of the
 * package (`shellVersionError`), which fails `next build` and `next dev`.
 */
export function withStagecraft(config: NextConfig = {}, appRoot: string = process.cwd()): NextConfig {
  const shellError = shellVersionError(appRoot);
  if (shellError) throw new Error(shellError);
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
