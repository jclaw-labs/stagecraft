"use client";

import { useState } from "react";

type ConnectVercelProps = {
  /** When provided, shows "Connected as <username>" + a Disconnect button. */
  connectedUsername?: string | null;
};

/**
 * Client form for pasting a Vercel Personal Access Token. Posts to
 * /api/integrations/vercel/connect, which validates against /v2/user
 * before storing. Server-side route returns a clear error for invalid
 * tokens, surfaced inline below the input.
 */
export function ConnectVercel({ connectedUsername }: ConnectVercelProps) {
  const [token, setToken] = useState("");
  const [teamId, setTeamId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/integrations/vercel/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: token.trim(),
          ...(teamId.trim() ? { teamId: teamId.trim() } : {}),
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Failed to connect Vercel");
        setPending(false);
        return;
      }
      // Reload so the server-rendered page shows the new connected state
      window.location.assign("/settings?success=vercel_connected");
    } catch {
      setError("Network error connecting to Vercel");
      setPending(false);
    }
  }

  async function handleDisconnect() {
    if (!confirm("Disconnect Vercel? Existing sites stay deployed; you won't be able to create new Vercel-backed sites until you reconnect.")) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/integrations/vercel/connect", { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? "Failed to disconnect Vercel");
        setPending(false);
        return;
      }
      window.location.assign("/settings?success=vercel_disconnected");
    } catch {
      setError("Network error disconnecting Vercel");
      setPending(false);
    }
  }

  if (connectedUsername) {
    return (
      <div>
        <p>
          Connected as <strong>{connectedUsername}</strong>
        </p>
        <div style={{ marginTop: "var(--space-3)", padding: "var(--space-3)", background: "var(--color-info-bg)", borderRadius: "var(--radius)", border: "1px solid var(--color-info-border)" }}>
          <p style={{ margin: 0, fontSize: "var(--font-size-sm)", fontWeight: "var(--font-weight-semibold)" }}>
            Step 2: Install Vercel&rsquo;s GitHub App
          </p>
          <p style={{ margin: "var(--space-1) 0 0", fontSize: "var(--font-size-sm)", color: "var(--color-text-muted)" }}>
            Vercel needs its GitHub App installed on your account to link repositories for auto-deploy.
            If you haven&rsquo;t done this yet:
          </p>
          <a
            href="https://github.com/apps/vercel/installations/new"
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: "inline-block", marginTop: "var(--space-2)", fontSize: "var(--font-size-sm)", fontWeight: "var(--font-weight-semibold)", color: "var(--color-brand)" }}
          >
            Install Vercel GitHub App &rarr;
          </a>
        </div>
        <button
          type="button"
          onClick={handleDisconnect}
          disabled={pending}
          style={{ marginTop: "var(--space-3)" }}
        >
          {pending ? "Disconnecting…" : "Disconnect"}
        </button>
        {error && (
          <p style={{ color: "var(--color-error)", marginTop: "var(--space-2)", fontSize: "var(--font-size-sm)" }}>{error}</p>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={handleConnect} style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
      <p style={{ color: "var(--color-text-muted)", fontSize: "var(--font-size-sm)", marginTop: 0 }}>
        Generate a token at{" "}
        <a
          href="https://vercel.com/account/tokens"
          target="_blank"
          rel="noopener noreferrer"
        >
          vercel.com/account/tokens
        </a>
        , then paste it below. Token scope: <strong>Full Account</strong> (default).
      </p>
      <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
        <span style={{ fontSize: "var(--font-size-sm)", fontWeight: "var(--font-weight-semibold)" }}>Personal access token</span>
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="vercel_…"
          required
          autoComplete="off"
          spellCheck={false}
          style={{ padding: "var(--space-2)", fontFamily: "var(--font-mono)", background: "var(--color-surface)", color: "var(--color-text)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)" }}
        />
      </label>
      <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
        <span style={{ fontSize: "var(--font-size-sm)", fontWeight: "var(--font-weight-semibold)" }}>
          Team ID <span style={{ color: "var(--color-text-faint)", fontWeight: "var(--font-weight-normal)" }}>(optional — leave blank for personal account)</span>
        </span>
        <input
          type="text"
          value={teamId}
          onChange={(e) => setTeamId(e.target.value)}
          placeholder="team_…"
          autoComplete="off"
          spellCheck={false}
          style={{ padding: "var(--space-2)", fontFamily: "var(--font-mono)", background: "var(--color-surface)", color: "var(--color-text)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)" }}
        />
      </label>
      <button type="submit" disabled={pending || !token.trim()} style={{ marginTop: "var(--space-2)" }}>
        {pending ? "Connecting…" : "Connect Vercel"}
      </button>
      {error && (
        <p style={{ color: "var(--color-error)", marginTop: "var(--space-1)", fontSize: "var(--font-size-sm)" }}>{error}</p>
      )}
    </form>
  );
}
