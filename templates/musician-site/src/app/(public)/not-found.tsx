import Link from "next/link";

/**
 * Public 404 body, in the artist's theme.
 *
 * Two places render it:
 *   - `app/global-not-found.tsx`, for every URL no route serves. The
 *     public catch-all is prerendered with `dynamicParams = false`, so an
 *     unknown URL never reaches it and Next serves the global 404.
 *   - this file as the `(public)` group's not-found boundary, for a
 *     `notFound()` thrown inside a public page. The group's layout
 *     already wraps it there.
 *
 * It lives in the group rather than at `app/not-found.tsx` because Next
 * puts the root not-found boundary into the RSC payload of every route.
 * A root 404 wrapped in the public layout made each admin response read
 * the appearance and site config and ship the artist's theme (#390).
 *
 * The body is local rather than Next's built-in 404 UI, which lives
 * under an internal `next/dist` path a Next upgrade could move. Its
 * colours, type and spacing come from theme tokens or the theme's own
 * element rules, so it follows the artist's palette and fonts.
 *
 * `/admin/*` has its own `admin/not-found.tsx` in the admin look.
 */
export default function PublicNotFound() {
  return (
    <main
      style={{
        // One viewport tall, with border-box keeping the padding inside
        // that height at any theme density. globals.css resets the body
        // margin on public pages (`body:has(> .stagecraft-site)`, #388),
        // so this is exactly one viewport with no margin arithmetic.
        boxSizing: "border-box",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "var(--space-8) var(--space-4)",
        textAlign: "center",
      }}
    >
      {/* Unstyled on purpose: the theme's own h1 rule sets its font,
          weight and display scale. */}
      <h1 style={{ margin: 0 }}>404</h1>
      <p
        style={{
          margin: "var(--space-2) 0 var(--space-6)",
          color: "var(--color-text-muted)",
          lineHeight: "var(--line-height-base)",
        }}
      >
        This page could not be found.
      </p>
      <Link href="/">Back to home</Link>
    </main>
  );
}
