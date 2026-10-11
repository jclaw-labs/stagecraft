/**
 * Every `/admin` URL: the admin router maps the path to a page module, and
 * calls `notFound()` (rendering `admin/not-found.tsx`) for any it doesn't
 * serve. Middleware signs the visitor in first.
 *
 * `dynamic` stays a literal here because Next.js reads route segment
 * config statically. Admin pages branch on the session and on first-run
 * state; left static, `next build` would bake in whichever redirect the
 * build-time content produced.
 */
export { default, generateMetadata } from "../../../admin/router.js";

export const dynamic = "force-dynamic";
