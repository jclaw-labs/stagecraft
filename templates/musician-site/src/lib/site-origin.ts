/**
 * The deployed site's own origin, for resolving root-relative URLs in
 * head metadata (`og:image`) into the absolute URLs Next requires there.
 *
 * Netlify (`NETLIFY=true`) sets `URL` at build time to the site's main
 * address (its custom domain once one is attached) in every context, so
 * a deploy preview or branch deploy reads its own `DEPLOY_PRIME_URL`
 * instead: a cover added in that change only exists on the preview. On
 * Vercel, Next falls back to `VERCEL_PROJECT_PRODUCTION_URL` (or the
 * branch URL on previews) by itself when `metadataBase` is unset, so
 * this returns `undefined` there and leaves that fallback in charge.
 * Anywhere else Next resolves against `http://localhost:3000`, which is
 * right for local builds only. `URL` is too generic a name to trust off
 * Netlify.
 */
export function deployedSiteOrigin(env: Record<string, string | undefined> = process.env): URL | undefined {
  if (env.NETLIFY !== "true") return undefined;
  const isPreview = !!env.CONTEXT && env.CONTEXT !== "production";
  const raw = ((isPreview ? env.DEPLOY_PRIME_URL : undefined) || env.URL)?.trim();
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? new URL(url.origin) : undefined;
  } catch {
    return undefined;
  }
}
