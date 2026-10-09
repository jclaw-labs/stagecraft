/**
 * Template file reader — shared between create-site and migrate-site jobs.
 *
 * The musician-site template is bundled at build time by
 * `scripts/generate-template-bundle.mjs` (which owns the skip rules for
 * binary files, build artifacts, and files that should not be committed)
 * into `src/generated/template-bundle.json`. Reading from that module rather
 * than the filesystem lets the jobs run where there is no filesystem
 * (Cloudflare Workers) as well as on Netlify.
 */

export type TemplateFile = { path: string; content: string };

/**
 * Return the musician-site template's text files.
 *
 * Async so the bundle is loaded lazily (only the jobs pay for it), and so
 * a future out-of-bundle source (e.g. R2) can slot in without changing
 * callers. Returns a fresh array each call so callers can't mutate the
 * shared module data.
 */
export async function readTemplateFiles(): Promise<TemplateFile[]> {
  const { default: bundle } = await import("@/generated/template-bundle.json");
  return (bundle as TemplateFile[]).map((f) => ({ path: f.path, content: f.content }));
}
