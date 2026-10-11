export {
  default,
  generateMetadata,
  generateStaticParams,
} from "@jclaw-labs/musician-site/app/(public)/[[...slug]]/page";

// A literal: Next.js reads route segment config statically. Every public
// URL is prerendered, and any other URL gets the global 404.
export const dynamicParams = false;
