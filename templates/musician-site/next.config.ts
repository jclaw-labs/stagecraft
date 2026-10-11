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

/**
 * Packages this template depends on that it builds from source.
 * `@jclaw-labs/content-upgraders` resolves to its `dist/` build by
 * default, which nothing builds before `next build` or `next dev`; its
 * `source` condition names the TypeScript entry instead. The path goes
 * through `node_modules`, so it holds wherever npm installed the package
 * from (the monorepo workspace, or a site copy's vendored copy).
 */
export const SOURCE_PACKAGE_ALIASES: Record<string, string> = {
  "@jclaw-labs/content-upgraders$": path.join(
    import.meta.dirname,
    "node_modules",
    "@jclaw-labs",
    "content-upgraders",
    "src",
    "index.ts",
  ),
};

/** The part of webpack's config the `webpack` hook below changes. */
type WebpackConfigSubset = {
  resolve: { alias?: Record<string, string>; extensionAlias?: Record<string, string[]> };
};

/** The `source` targets of package.json's subpath imports, as webpack aliases. */
export const SOURCE_ALIASES: Record<string, string> = Object.fromEntries(
  ["lib", "components", "puck"].map((dir) => [`#${dir}`, path.join(import.meta.dirname, "src", dir)]),
);

const config: NextConfig = {
  reactStrictMode: true,
  // Compile the source-built packages above, wherever npm put them.
  transpilePackages: ["@jclaw-labs/content-upgraders"],
  ...(monorepoRoot ? { outputFileTracingRoot: monorepoRoot } : {}),
  /**
   * `#lib/…`, `#components/…` and `#puck/…` are subpath imports declared
   * in package.json. Their default target is the `dist/` build the
   * published package ships; this app builds from source, so point them
   * at `src/` (the `source` condition's target). Next.js's layers set
   * their own resolve conditions, so an alias is what reaches all of them.
   * Specifiers carry `.js` (what the `dist/` build needs), which names a
   * `.ts` or `.tsx` file in `src/`.
   */
  webpack(webpackConfig: WebpackConfigSubset) {
    webpackConfig.resolve.alias = { ...webpackConfig.resolve.alias, ...SOURCE_ALIASES, ...SOURCE_PACKAGE_ALIASES };
    webpackConfig.resolve.extensionAlias = {
      ...webpackConfig.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return webpackConfig;
  },
  experimental: {
    /**
     * Serve unmatched URLs from `src/app/global-not-found.tsx`. A root
     * `app/not-found.tsx` would go into the RSC payload of every route,
     * admin included, and the public 404 renders the artist's theme
     * (#390). Experimental in Next 15.4+.
     */
    globalNotFound: true,
  },
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
          // `no-transform` forbids intermediate proxies / CDNs from
          // rewriting the SVG bytes (some optimise by inlining as a
          // data URI, stripping XML declarations, or rewriting
          // namespaces). The sanitiser has already locked the
          // content shape on the way in; allowing a CDN to mutate
          // it would re-open the surface we just closed.
          { key: "Cache-Control", value: "no-transform" },
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
