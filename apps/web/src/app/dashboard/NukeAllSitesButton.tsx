"use client";

import { useState } from "react";

/**
 * Operator escape hatch: deletes every Site the signed-in user owns
 * plus the matching GitHub repo + Vercel/Netlify project for each.
 *
 * Server-side gate on `/api/admin/nuke-my-sites` enforces the email
 * allowlist — rendering this component for a non-admin is a no-op
 * because the API will reject. We only render it on the dashboard
 * when the server-side check passes (see DashboardPage), but the
 * server is the authority.
 *
 * Two-step confirmation:
 *   1. First click reveals the inline confirm with a typed-confirm
 *      sentinel so a misclick doesn't blow away everything.
 *   2. Type the sentinel + click again to actually fire.
 */
export function NukeAllSitesButton({ siteCount }: { siteCount: number }) {
  const [phase, setPhase] = useState<"idle" | "confirming" | "working" | "done" | "error">("idle");
  const [confirmText, setConfirmText] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<{ deleted: number; errored: number } | null>(null);

  const SENTINEL = "nuke all my sites";

  async function handleNuke() {
    setPhase("working");
    setErrorMessage(null);
    try {
      const res = await fetch("/api/admin/nuke-my-sites", { method: "POST" });
      const body = (await res.json()) as
        | { deleted: number; sites: Array<{ id: string; errors: string[] }> }
        | { error?: string };
      if (!res.ok) {
        setPhase("error");
        setErrorMessage(("error" in body && body.error) || `HTTP ${res.status}`);
        return;
      }
      if ("deleted" in body) {
        const errored = body.sites.filter((s) => s.errors.length > 0).length;
        setResult({ deleted: body.deleted, errored });
        setPhase("done");
        // Refresh so the (now empty) sites list renders.
        setTimeout(() => window.location.reload(), 1500);
      }
    } catch (cause) {
      setPhase("error");
      setErrorMessage(cause instanceof Error ? cause.message : "Network error");
    }
  }

  if (siteCount === 0 && phase !== "done") return null;

  if (phase === "done" && result) {
    return (
      <div
        style={{
          marginTop: "var(--space-4)",
          padding: "var(--space-3)",
          background: "var(--color-success-bg)",
          color: "var(--color-success)",
          borderRadius: "var(--radius)",
          fontSize: "var(--font-size-sm)",
        }}
        role="status"
      >
        Deleted {result.deleted} site{result.deleted === 1 ? "" : "s"}
        {result.errored > 0
          ? ` (${result.errored} had external-cleanup errors — check server logs)`
          : ""}
        . Reloading…
      </div>
    );
  }

  return (
    <div
      style={{
        marginTop: "var(--space-6)",
        padding: "var(--space-4)",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-lg)",
        background: "var(--color-surface)",
      }}
    >
      <h3 style={{ margin: 0, fontSize: "var(--font-size-sm)", color: "var(--color-text-muted)" }}>
        Admin tools
      </h3>
      <p style={{ fontSize: "var(--font-size-sm)", color: "var(--color-text-muted)", marginTop: "var(--space-2)" }}>
        Delete every Stagecraft site on your account — including the GitHub repo and the Vercel/Netlify project for each. Best-effort external cleanup; failures are reported but don&rsquo;t block the DB delete.
      </p>

      {phase === "idle" && (
        <button
          type="button"
          onClick={() => setPhase("confirming")}
          style={{
            marginTop: "var(--space-2)",
            padding: "var(--space-2) var(--space-3)",
            background: "var(--color-error-bg)",
            color: "var(--color-error)",
            border: "1px solid var(--color-error)",
            borderRadius: "var(--radius-sm)",
            fontSize: "var(--font-size-sm)",
            cursor: "pointer",
          }}
        >
          Nuke all {siteCount} site{siteCount === 1 ? "" : "s"}…
        </button>
      )}

      {phase === "confirming" && (
        <div style={{ marginTop: "var(--space-3)", display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", fontSize: "var(--font-size-sm)" }}>
            Type <code style={{ color: "var(--color-text)", fontFamily: "var(--font-mono)" }}>{SENTINEL}</code> to confirm:
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              autoFocus
              style={{
                padding: "var(--space-2)",
                background: "var(--color-surface)",
                color: "var(--color-text)",
                border: "1px solid var(--color-border)",
                borderRadius: "var(--radius-sm)",
                fontFamily: "var(--font-mono)",
              }}
            />
          </label>
          <div style={{ display: "flex", gap: "var(--space-2)" }}>
            <button
              type="button"
              onClick={handleNuke}
              disabled={confirmText !== SENTINEL}
              style={{
                padding: "var(--space-2) var(--space-3)",
                background: confirmText === SENTINEL ? "var(--color-error)" : "var(--color-disabled)",
                color: confirmText === SENTINEL ? "#ffffff" : "var(--color-text-muted)",
                border: "none",
                borderRadius: "var(--radius-sm)",
                fontSize: "var(--font-size-sm)",
                cursor: confirmText === SENTINEL ? "pointer" : "not-allowed",
              }}
            >
              Yes, delete all {siteCount} site{siteCount === 1 ? "" : "s"}
            </button>
            <button
              type="button"
              onClick={() => {
                setPhase("idle");
                setConfirmText("");
              }}
              style={{
                padding: "var(--space-2) var(--space-3)",
                background: "var(--color-surface)",
                color: "var(--color-text)",
                border: "1px solid var(--color-border)",
                borderRadius: "var(--radius-sm)",
                fontSize: "var(--font-size-sm)",
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {phase === "working" && (
        <p style={{ marginTop: "var(--space-2)", fontSize: "var(--font-size-sm)", color: "var(--color-text-muted)" }}>
          Deleting…
        </p>
      )}

      {phase === "error" && errorMessage && (
        <p style={{ marginTop: "var(--space-2)", fontSize: "var(--font-size-sm)", color: "var(--color-error)" }} role="alert">
          {errorMessage}
        </p>
      )}
    </div>
  );
}
