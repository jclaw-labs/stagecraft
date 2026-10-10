/**
 * The deployed site's own origin, for resolving root-relative URLs in
 * head metadata (`og:image`) into the absolute URLs Next requires there.
 *
 * Netlify sets `URL` at build time to the site's main address (its
 * custom domain once one is attached). On Vercel, Next falls back to
 * `VERCEL_PROJECT_PRODUCTION_URL` by itself when `metadataBase` is
 * unset, so this returns `undefined` there and leaves that fallback in
 * charge. Anywhere else Next resolves against `http://localhost:3000`,
 * which is right for local builds only.
 */
export function deployedSiteOrigin(env: Record<string, string | undefined> = process.env): URL | undefined {
  const raw = env.URL?.trim();
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? new URL(url.origin) : undefined;
  } catch {
    return undefined;
  }
}
