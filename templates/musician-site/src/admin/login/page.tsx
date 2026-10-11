import Link from "next/link";

type SearchParams = { error?: string; sent?: string };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const isDev = process.env.NODE_ENV !== "production";

  if (params.sent) {
    return (
      <main
        style={{
          maxWidth: "var(--max-width-narrow)",
          margin: "var(--space-16) auto",
          padding: "0 var(--space-4)",
        }}
      >
        <h1>Check your email</h1>
        <p>If that email is allowed for this site, a sign-in link is on its way. The link expires in 10 minutes.</p>
        <p>
          <Link href="/admin/login">Back to sign in</Link>
        </p>
      </main>
    );
  }

  return (
    <main
      style={{
        maxWidth: "var(--max-width-narrow)",
        margin: "var(--space-16) auto",
        padding: "0 var(--space-4)",
      }}
    >
      <h1>Sign in</h1>
      {params.error ? (
        <p style={{ color: "var(--color-text-error)" }}>That sign-in link was invalid or expired. Try again.</p>
      ) : null}
      <form action="/api/auth/request" method="POST">
        <label style={{ display: "block", marginBottom: "var(--space-2)" }}>
          Email
          <input
            name="email"
            type="email"
            required
            autoFocus
            style={{
              display: "block",
              width: "100%",
              padding: "var(--space-2)",
              marginTop: "var(--space-1)",
            }}
          />
        </label>
        <button type="submit" style={{ padding: "var(--space-2) var(--space-4)" }}>
          Send sign-in link
        </button>
        {isDev ? (
          <button
            type="submit"
            formAction="/api/auth/dev-login"
            formNoValidate
            style={{
              marginLeft: "var(--space-2)",
              padding: "var(--space-2) var(--space-4)",
              background: "transparent",
              border: "1px solid var(--color-border)",
              color: "var(--color-text-muted)",
              fontSize: "var(--font-size-sm)",
            }}
          >
            Sign in as dev admin (skip magic link)
          </button>
        ) : null}
      </form>
      {isDev ? (
        <p
          style={{
            marginTop: "var(--space-4)",
            color: "var(--color-text-muted)",
            fontSize: "var(--font-size-sm)",
          }}
        >
          Dev-only: the second button skips the magic-link round-trip and signs you in directly. Disabled in production.
        </p>
      ) : null}
    </main>
  );
}
