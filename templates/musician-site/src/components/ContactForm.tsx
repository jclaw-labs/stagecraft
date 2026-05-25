"use client";

import { useState, type CSSProperties, type FormEvent } from "react";

/**
 * Public contact form rendered inside the Puck `ContactForm` block.
 *
 * Mirrors the legacy template's `ContactForm.astro`:
 *
 *   - Required fields: name, email, message (subject optional).
 *   - Empty-input honeypot (`website`) for spam — visible to bots,
 *     hidden from people via the screenreader-only wrapper.
 *   - Submits FormData to `/api/contact` and reports status inline
 *     so the page never reloads. Disables the submit button while
 *     in flight so a double-click can't double-send.
 *
 * Styling stays inline + design-token-only per CLAUDE.md §7 so the
 * form sits inside whatever Section / column the artist drops it into
 * without dragging in a stylesheet.
 */

type Status =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

const fieldStyle: CSSProperties = {
  display: "block",
  width: "100%",
  padding: "var(--space-2) var(--space-3)",
  fontSize: "var(--font-size-base)",
  fontFamily: "var(--font-body)",
  border: "var(--border-width) solid var(--color-border-strong)",
  borderRadius: "var(--radius-sm)",
  background: "var(--color-surface)",
  color: "var(--color-text)",
  marginTop: "var(--space-1)",
};

const labelStyle: CSSProperties = {
  display: "block",
  fontSize: "var(--font-size-sm)",
  fontWeight: "var(--font-weight-semibold)" as unknown as number,
  color: "var(--color-text-emphasis)",
  marginBottom: "var(--space-1)",
};

const fieldWrapStyle: CSSProperties = { marginBottom: "var(--space-4)" };

const screenReaderOnly: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0,0,0,0)",
  border: 0,
};

function buttonStyle(isDisabled: boolean): CSSProperties {
  const bg = isDisabled ? "var(--color-action-disabled)" : "var(--color-action)";
  return {
    display: "inline-block",
    padding: "var(--space-2) var(--space-4)",
    borderRadius: "var(--radius)",
    fontWeight: "var(--font-weight-semibold)" as unknown as number,
    cursor: isDisabled ? "default" : "pointer",
    background: bg,
    color: "var(--color-action-fg)",
    border: `var(--border-width) solid ${bg}`,
  };
}

const statusBaseStyle: CSSProperties = {
  marginTop: "var(--space-4)",
  padding: "var(--space-2) var(--space-3)",
  borderRadius: "var(--radius-sm)",
  fontSize: "var(--font-size-sm)",
  background: "var(--color-surface-subtle)",
  border: "var(--border-width) solid var(--color-border)",
};

const statusSuccessStyle: CSSProperties = {
  ...statusBaseStyle,
  color: "var(--color-text-emphasis)",
};

const statusErrorStyle: CSSProperties = {
  ...statusBaseStyle,
  color: "var(--color-text-error)",
};

export function ContactForm() {
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status.kind === "sending") return;
    setStatus({ kind: "sending" });
    const formData = new FormData(event.currentTarget);
    try {
      const res = await fetch("/api/contact", { method: "POST", body: formData });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (res.ok && body.ok) {
        setStatus({ kind: "success", message: "Message sent — we'll be in touch." });
        event.currentTarget.reset();
      } else {
        setStatus({
          kind: "error",
          message: body.error ?? "Something went wrong. Please try again.",
        });
      }
    } catch {
      setStatus({
        kind: "error",
        message: "Network error. Check your connection and try again.",
      });
    }
  }

  const isSending = status.kind === "sending";

  return (
    <form
      onSubmit={handleSubmit}
      style={{ maxWidth: "var(--max-width-content)", margin: "0 auto", padding: "var(--space-4)" }}
    >
      <div aria-hidden style={screenReaderOnly}>
        <label htmlFor="cf-website">Website</label>
        <input
          id="cf-website"
          type="text"
          name="website"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      <div style={fieldWrapStyle}>
        <label htmlFor="cf-name" style={labelStyle}>Name</label>
        <input
          id="cf-name"
          name="name"
          type="text"
          required
          autoComplete="name"
          style={fieldStyle}
        />
      </div>

      <div style={fieldWrapStyle}>
        <label htmlFor="cf-email" style={labelStyle}>Email</label>
        <input
          id="cf-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          style={fieldStyle}
        />
      </div>

      <div style={fieldWrapStyle}>
        <label htmlFor="cf-subject" style={labelStyle}>Subject</label>
        <input
          id="cf-subject"
          name="subject"
          type="text"
          style={fieldStyle}
        />
      </div>

      <div style={fieldWrapStyle}>
        <label htmlFor="cf-message" style={labelStyle}>Message</label>
        <textarea
          id="cf-message"
          name="message"
          required
          rows={5}
          style={{ ...fieldStyle, resize: "vertical", fontFamily: "var(--font-body)" }}
        />
      </div>

      <button type="submit" disabled={isSending} style={buttonStyle(isSending)}>
        {isSending ? "Sending…" : "Send message"}
      </button>

      {status.kind === "success" ? (
        <div role="status" aria-live="polite" style={statusSuccessStyle}>
          {status.message}
        </div>
      ) : null}
      {status.kind === "error" ? (
        <div role="status" aria-live="polite" style={statusErrorStyle}>
          {status.message}
        </div>
      ) : null}
    </form>
  );
}
