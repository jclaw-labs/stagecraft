"use client";

import { useState } from "react";

type ConnectResendProps = {
  /** When set, shows the connected state + Disconnect button. */
  connectedAdminEmail?: string | null;
  /**
   * Where to send the artist after a successful connect. Defaults to
   * the settings page's own success-banner route; the /onboarding flow
   * overrides to "/dashboard" so the first-time setup hands the artist
   * to the dashboard instead of looping back to /settings.
   */
  successRedirect?: string;
};

type Phase = "key" | "verify";

/**
 * Two-phase form, intentionally minimal:
 *   1. Paste API key + Resend account email → /verify-send fires a code
 *      via the Resend sandbox sender (which only delivers to the
 *      account-registered email — successful delivery doubles as proof
 *      the address is correct).
 *   2. Enter code → /connect persists the integration and writes the
 *      verified email to User.email (single source of truth for the
 *      artist's identity across the platform + their artist sites).
 *
 * No sender-picker UI: Stagecraft always sends from
 * `onboarding@resend.dev` for now. ADMIN_EMAIL = User.email = Resend
 * account email, so sandbox always reaches the recipient. Custom-
 * domain senders come later as a per-site setting.
 */
export function ConnectResend({
  connectedAdminEmail,
  successRedirect = "/settings?success=resend_connected",
}: ConnectResendProps) {
  const [phase, setPhase] = useState<Phase>("key");
  const [token, setToken] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [verificationToken, setVerificationToken] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [pendingDisconnect, setPendingDisconnect] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSendCode(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/integrations/resend/verify-send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: token.trim(),
          adminEmail: adminEmail.trim(),
        }),
      });
      const data = (await res.json()) as { error?: string; verificationToken?: string };
      if (!res.ok || !data.verificationToken) {
        setError(data.error ?? "Failed to send verification code");
        setPending(false);
        return;
      }
      setVerificationToken(data.verificationToken);
      setPhase("verify");
      setPending(false);
    } catch {
      setError("Network error sending verification code");
      setPending(false);
    }
  }

  async function handleConfirmCode(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/integrations/resend/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: token.trim(),
          verificationToken,
          code: code.trim(),
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Failed to connect Resend");
        setPending(false);
        return;
      }
      window.location.assign(successRedirect);
    } catch {
      setError("Network error connecting to Resend");
      setPending(false);
    }
  }

  async function handleDisconnect() {
    if (!confirm("Disconnect Resend? Existing artist sites keep working until their next deploy; new /create runs will be blocked until you reconnect.")) {
      return;
    }
    setPendingDisconnect(true);
    setError(null);
    try {
      const res = await fetch("/api/integrations/resend/connect", { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? "Failed to disconnect Resend");
        setPendingDisconnect(false);
        return;
      }
      window.location.assign("/settings?success=resend_disconnected");
    } catch {
      setError("Network error disconnecting Resend");
      setPendingDisconnect(false);
    }
  }

  const inputStyle = {
    padding: "var(--space-2)",
    fontFamily: "var(--font-mono)",
    background: "var(--color-surface)",
    color: "var(--color-text)",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-sm)",
  } as const;

  if (connectedAdminEmail) {
    return (
      <div>
        <p>
          Magic-link emails for your artist sites go to <strong>{connectedAdminEmail}</strong>.
        </p>
        <button
          type="button"
          onClick={handleDisconnect}
          disabled={pendingDisconnect}
          style={{ marginTop: "var(--space-2)" }}
        >
          {pendingDisconnect ? "Disconnecting…" : "Disconnect"}
        </button>
        {error && (
          <p style={{ color: "var(--color-error)", marginTop: "var(--space-2)", fontSize: "var(--font-size-sm)" }}>{error}</p>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
      <p style={{ color: "var(--color-text-muted)", fontSize: "var(--font-size-sm)", marginTop: 0 }}>
        Generate an API key at{" "}
        <a href="https://resend.com/api-keys" target="_blank" rel="noopener noreferrer">
          resend.com/api-keys
        </a>
        . The default &ldquo;Sending access&rdquo; key Resend gives you at signup is fine.
      </p>

      {phase === "key" && (
        <form onSubmit={handleSendCode} style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
            <span style={{ fontSize: "var(--font-size-sm)", fontWeight: "var(--font-weight-semibold)" }}>Resend API key</span>
            <input
              type="password"
              value={token}
              onChange={(e) => {
                setToken(e.target.value);
                setError(null);
              }}
              placeholder="re_…"
              required
              autoComplete="off"
              spellCheck={false}
              disabled={pending}
              style={inputStyle}
            />
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
            <span style={{ fontSize: "var(--font-size-sm)", fontWeight: "var(--font-weight-semibold)" }}>Your Resend account email</span>
            <input
              type="email"
              value={adminEmail}
              onChange={(e) => {
                setAdminEmail(e.target.value);
                setError(null);
              }}
              placeholder="the email you signed up to Resend with"
              required
              disabled={pending}
              style={inputStyle}
            />
            <span style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)" }}>
              Used as the admin sign-in for every artist site you create. We&rsquo;ll send a one-time code here through your Resend account to confirm it&rsquo;s reachable — Resend&rsquo;s sandbox sender only delivers to your own account email, so this also confirms the address is right.
            </span>
          </label>

          <button
            type="submit"
            disabled={pending || !token.trim() || !adminEmail.trim()}
            style={{ marginTop: "var(--space-1)" }}
          >
            {pending ? "Sending code…" : "Send verification code"}
          </button>
        </form>
      )}

      {phase === "verify" && (
        <form onSubmit={handleConfirmCode} style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
            <span style={{ fontSize: "var(--font-size-sm)", fontWeight: "var(--font-weight-semibold)" }}>Verification code</span>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="123456"
              required
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern="\d{6}"
              autoFocus
              style={{ ...inputStyle, letterSpacing: 4, fontSize: "var(--font-size-lg)" }}
            />
            <span style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)" }}>
              Check <strong>{adminEmail}</strong> for the 6-digit code (expires in 10 min). Wrong inbox?{" "}
              <button
                type="button"
                onClick={() => {
                  setPhase("key");
                  setCode("");
                  setError(null);
                }}
                style={{ background: "none", border: "none", color: "var(--color-brand)", padding: 0, cursor: "pointer" }}
              >
                Go back and change email
              </button>
            </span>
          </label>
          <button type="submit" disabled={pending || code.length !== 6}>
            {pending ? "Connecting…" : "Connect Resend"}
          </button>
        </form>
      )}

      {error && (
        <p style={{ color: "var(--color-error)", marginTop: "var(--space-1)", fontSize: "var(--font-size-sm)" }}>{error}</p>
      )}
    </div>
  );
}
