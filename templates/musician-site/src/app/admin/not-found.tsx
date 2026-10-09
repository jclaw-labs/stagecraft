import Link from "next/link";

/**
 * 404 for `/admin/*`: a `notFound()` from any admin page, and any admin
 * URL no route serves (via the `[...unknown]` catch-all beside it).
 *
 * Without this, those fell through to the public 404, which renders
 * inside the public layout and so carries the artist's theme and site
 * title. This uses the admin's neutral tokens and the same
 * minimal frame as `/admin/login`. The tab keeps the root layout's
 * title, like every other admin page.
 */
export default function AdminNotFound() {
  return (
    <main
      data-admin-not-found
      style={{
        maxWidth: "var(--max-width-narrow)",
        margin: "var(--space-16) auto",
        padding: "0 var(--space-4)",
        color: "var(--color-text)",
        fontFamily: "var(--font-body)",
      }}
    >
      <h1
        style={{
          margin: 0,
          fontSize: "var(--font-size-xl)",
          fontWeight: "var(--font-weight-semibold)" as unknown as number,
        }}
      >
        Page not found
      </h1>
      <p
        style={{
          margin: "var(--space-2) 0 var(--space-6)",
          fontSize: "var(--font-size-sm)",
          color: "var(--color-text-muted)",
          lineHeight: "var(--line-height-base)",
        }}
      >
        There&apos;s nothing in the admin at this address. It may have been renamed or deleted.
      </p>
      <Link
        href="/admin/pages"
        style={{ fontSize: "var(--font-size-sm)", color: "var(--color-text)" }}
      >
        Back to Pages
      </Link>
    </main>
  );
}
