"use client";

import { useState } from "react";

type ConnectNetlifyProps = {
  connectedEmail?: string | null;
};

export function ConnectNetlify({ connectedEmail }: ConnectNetlifyProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDisconnect() {
    if (
      !confirm(
        "Disconnect Netlify? Existing sites stay deployed; you won’t be able to create new Netlify-backed sites until you reconnect.",
      )
    ) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/integrations/netlify", { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? "Failed to disconnect Netlify");
        setPending(false);
        return;
      }
      window.location.assign("/settings?success=netlify_disconnected");
    } catch {
      setError("Network error disconnecting Netlify");
      setPending(false);
    }
  }

  if (connectedEmail) {
    return (
      <div>
        <p>
          Connected as <strong>{connectedEmail}</strong>
        </p>
        <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-3)" }}>
          <a href="/api/integrations/netlify" style={{ fontSize: "var(--font-size-sm)", color: "var(--color-brand)" }}>
            Reconnect
          </a>
          <button
            type="button"
            onClick={handleDisconnect}
            disabled={pending}
          >
            {pending ? "Disconnecting…" : "Disconnect"}
          </button>
        </div>
        {error && (
          <p style={{ color: "var(--color-error)", marginTop: "var(--space-2)", fontSize: "var(--font-size-sm)" }}>{error}</p>
        )}
      </div>
    );
  }

  return <a href="/api/integrations/netlify">Connect Netlify</a>;
}
