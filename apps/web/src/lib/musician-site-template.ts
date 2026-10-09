import { MUSICIAN_SITE_TEMPLATE_FILES } from "@/generated/musician-site-template";
import type { TemplateFile } from "@/lib/template-reader";

/**
 * The musician-site template's text files, bundled at build time (see
 * template-bundle.ts). Returns a fresh array so callers can't mutate the
 * shared bundle.
 */
export function getMusicianSiteTemplateFiles(): TemplateFile[] {
  return MUSICIAN_SITE_TEMPLATE_FILES.map((f) => ({ ...f }));
}
