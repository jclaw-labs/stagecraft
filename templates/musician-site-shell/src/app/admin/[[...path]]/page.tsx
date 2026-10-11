export { default, generateMetadata } from "@jclaw-labs/musician-site/admin/router";

// A literal: Next.js reads route segment config statically. Admin pages
// read the session and draft content on every request.
export const dynamic = "force-dynamic";
