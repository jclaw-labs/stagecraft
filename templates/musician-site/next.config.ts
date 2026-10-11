import type { NextConfig } from "next";
import path from "node:path";

import { withStagecraft } from "./src/lib/with-stagecraft";

/** The part of webpack's config the `webpack` hook below changes. */
type WebpackConfigSubset = {
  resolve: { alias?: Record<string, string>; extensionAlias?: Record<string, string[]> };
};

/** The `source` targets of package.json's subpath imports, as webpack aliases. */
export const SOURCE_ALIASES: Record<string, string> = Object.fromEntries(
  ["lib", "components", "puck"].map((dir) => [`#${dir}`, path.join(import.meta.dirname, "src", dir)]),
);

/**
 * The template builds as a site does, through `withStagecraft()` (headers,
 * `globalNotFound`, monorepo tracing root), plus the source build below.
 */
const config: NextConfig = withStagecraft({
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
    webpackConfig.resolve.alias = { ...webpackConfig.resolve.alias, ...SOURCE_ALIASES };
    webpackConfig.resolve.extensionAlias = {
      ...webpackConfig.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return webpackConfig;
  },
});

export default config;
