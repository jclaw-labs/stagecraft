"use client";

import { useId, useState, type CSSProperties, type FormEvent } from "react";

import {
  EMAIL_FIELD_NAME,
  NAME_FIELD_NAME,
  NEWSLETTER_SERVICES,
  NEWSLETTER_SERVICE_LABELS,
  parseMailchimpAudienceHoneypotName,
  type NewsletterService,
} from "./newsletter-types";

// Re-export for source-compat with callers (puck/config.tsx and the
// existing test file) that imported these from this module before
// they were extracted into the server-safe sibling. New consumers
// should import from `./newsletter-types` directly.
export {
  EMAIL_FIELD_NAME,
  NEWSLETTER_SERVICES,
  NEWSLETTER_SERVICE_LABELS,
  type NewsletterService,
};

/**
 * Public newsletter-signup form rendered inside the Puck
 * `NewsletterSignup` block.
 *
 * Mirrors the legacy template's `NewsletterSignup.astro` (which
 * itself ported MailChimp / ConvertKit / Buttondown integration
 * patterns): a `<form action={actionUrl} method="post">` that posts
 * an `email` field directly to the third-party provider, with two
 * honeypots for spam.
 *
 *   1. Universal `_gotcha` — checked client-side; non-empty → show
 *      a success message without POSTing so we don't tip off the
 *      bot.
 *   2. Mailchimp-specific `b_subscribe_honeypot` — Mailchimp's bot
 *      trap is an audience-suffixed `b_<list>_<id>` field; we emit
 *      a generic placeholder name as best-effort without parsing the
 *      actionUrl. Same approach the legacy template took.
 *
 * Cross-origin submission notes (legacy comment ported):
 *   - Mailchimp / ConvertKit reject CORS preflight from browser
 *     origins, so a normal fetch would fail before the server sees
 *     the request. `mode: "no-cors"` lets the POST through at the
 *     cost of an opaque response.
 *   - We treat any completion as success. The real confirmation is
 *     the subscriber's inbox (every service uses double opt-in).
 *   - Even a network error surfaces as success — the POST may have
 *     gone through and we just can't tell. Optimistic UX beats false
 *     negatives here.
 *
 * Multiple newsletter forms on one page stay independent via
 * `useId()`-generated input ids; the FormEvent's
 * `currentTarget.action` carries the per-form actionUrl.
 *
 * Styling stays inline + design-token-only per CLAUDE.md §7 so the
 * form sits inside whatever Section / column the artist drops it
 * into without dragging in a stylesheet.
 */

type Status =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "success"; message: string };

export type NewsletterSignupProps = {
  service: NewsletterService;
  actionUrl: string;
  title?: string;
  emailLabel?: string;
  submitLabel?: string;
  successMessage?: string;
  /**
   * When true, the form gains a first-name field alongside the
   * email. Posted under the service's name attribute via
   * `NAME_FIELD_NAME`. Off by default — most artist newsletters
   * collect email-only.
   */
  hasNameField?: boolean;
  /** Label for the name field when `hasNameField` is true. */
  nameLabel?: string;
};

export function NewsletterSignup({
  service,
  actionUrl,
  title,
  emailLabel = "Email",
  submitLabel = "Subscribe",
  successMessage = "Thanks for subscribing! Check your inbox to confirm.",
  hasNameField = false,
  nameLabel = "First name",
}: NewsletterSignupProps) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  // Stable per-instance input ids so multiple signup forms on one
  // page don't collide on the `<label htmlFor>` association.
  const baseId = useId();
  const emailId = `${baseId}-email`;
  const nameId = `${baseId}-name`;
  const gotchaId = `${baseId}-gotcha`;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status.kind === "sending") return;
    const fd = new FormData(event.currentTarget);

    // Honeypot. If a bot filled this in, we pretend to succeed
    // rather than POSTing — saves a request and doesn't tip off
    // the bot that we noticed.
    const gotcha = fd.get("_gotcha");
    if (typeof gotcha === "string" && gotcha.trim().length > 0) {
      setStatus({ kind: "success", message: successMessage });
      event.currentTarget.reset();
      return;
    }

    setStatus({ kind: "sending" });
    try {
      await fetch(actionUrl, {
        method: "POST",
        body: fd,
        mode: "no-cors",
      });
    } catch {
      // Even a network error: the POST may have completed
      // server-side; the no-cors response is opaque so we can't
      // tell. Prefer the optimistic UX.
    }
    setStatus({ kind: "success", message: successMessage });
    event.currentTarget.reset();
  }

  if (!actionUrl) {
    // Editor placeholder — no actionUrl configured yet. Don't render
    // a non-functional form on the public site; show an admin-
    // visible hint instead. The Puck block's editor preview will
    // see this; the artist sets actionUrl in the inspector.
    return (
      <div style={placeholderStyle}>
        Add the form submission URL from your newsletter provider to
        finish setting up this block.
      </div>
    );
  }

  const isSending = status.kind === "sending";

  return (
    <form
      onSubmit={handleSubmit}
      action={actionUrl}
      method="post"
      style={formStyle}
    >
      {title ? <h3 style={titleStyle}>{title}</h3> : null}

      <div aria-hidden="true" style={screenReaderOnly}>
        <label htmlFor={gotchaId}>Leave this field empty</label>
        <input
          id={gotchaId}
          type="text"
          name="_gotcha"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      {service === "mailchimp" ? (
        // Mailchimp's bot trap is a hidden field named `b_<u>_<id>`,
        // where `u` and `id` come from the embed URL's query string
        // (`?u=USER_ID&id=LIST_ID`). Real users leave it empty;
        // automation that scrapes the form often fills every input,
        // and Mailchimp's bot defense rejects submissions where it's
        // non-empty. When the actionUrl doesn't parse (artist using
        // a non-default custom domain or our regex doesn't match),
        // we fall back to the universal client-side `_gotcha` above
        // — strictly weaker but still functional.
        <div aria-hidden="true" style={screenReaderOnly}>
          {(() => {
            const suffixedName = parseMailchimpAudienceHoneypotName(actionUrl);
            return suffixedName ? (
              <input
                type="text"
                name={suffixedName}
                tabIndex={-1}
                autoComplete="off"
                defaultValue=""
              />
            ) : null;
          })()}
        </div>
      ) : null}

      {hasNameField ? (
        <div style={fieldRowStyle}>
          <label htmlFor={nameId} style={emailLabelStyle}>
            {nameLabel}
          </label>
          <input
            id={nameId}
            name={NAME_FIELD_NAME[service]}
            type="text"
            autoComplete="given-name"
            style={emailInputStyle}
            placeholder="Your name"
          />
        </div>
      ) : null}

      <div style={fieldRowStyle}>
        <label htmlFor={emailId} style={emailLabelStyle}>
          {emailLabel}
        </label>
        <input
          id={emailId}
          name={EMAIL_FIELD_NAME[service]}
          type="email"
          required
          autoComplete="email"
          style={emailInputStyle}
          placeholder="you@example.com"
        />
        <button type="submit" disabled={isSending} style={buttonStyle(isSending)}>
          {isSending ? "Subscribing…" : submitLabel}
        </button>
      </div>

      {/* Status union has only `success` today — the no-cors fetch is
          opaque, so an "error" state isn't reachable from a failed
          POST (we can't distinguish failure from success). Future:
          if we move ConvertKit / Buttondown to a real CORS fetch
          (their APIs support it), reintroduce an `error` kind and
          render it here. */}
      {status.kind === "success" ? (
        <div role="status" aria-live="polite" style={statusSuccessStyle}>
          {status.message}
        </div>
      ) : null}
    </form>
  );
}

// ---------------------------------------------------------------------------
// Styles — token-only per CLAUDE.md §7.
// ---------------------------------------------------------------------------

const formStyle: CSSProperties = {
  maxWidth: "var(--max-width-content)",
  margin: "0 auto",
  padding: "var(--space-4) 0",
};

const titleStyle: CSSProperties = {
  margin: "0 0 var(--space-3)",
  fontSize: "var(--font-size-lg)",
  fontWeight: "var(--font-weight-semibold)" as unknown as number,
  fontFamily: "var(--font-heading)",
  color: "var(--color-text-emphasis)",
};

const fieldRowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "var(--space-2)",
  alignItems: "stretch",
};

const emailLabelStyle: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0,0,0,0)",
  border: 0,
};

const emailInputStyle: CSSProperties = {
  flex: "1 1 200px",
  minWidth: 0,
  padding: "var(--space-2) var(--space-3)",
  fontSize: "var(--font-size-base)",
  fontFamily: "var(--font-body)",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "var(--radius-sm)",
  background: "var(--color-surface)",
  color: "var(--color-text)",
};

function buttonStyle(isDisabled: boolean): CSSProperties {
  const bg = isDisabled ? "var(--color-action-disabled)" : "var(--color-action)";
  return {
    flex: "0 0 auto",
    padding: "var(--space-2) var(--space-4)",
    borderRadius: "var(--radius)",
    fontWeight: "var(--font-weight-semibold)" as unknown as number,
    cursor: isDisabled ? "default" : "pointer",
    background: bg,
    color: "var(--color-action-fg)",
    border: `1px solid ${bg}`,
  };
}

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

const statusBaseStyle: CSSProperties = {
  marginTop: "var(--space-3)",
  padding: "var(--space-2) var(--space-3)",
  borderRadius: "var(--radius-sm)",
  fontSize: "var(--font-size-sm)",
  background: "var(--color-surface-subtle)",
  border: "1px solid var(--color-border)",
};

const statusSuccessStyle: CSSProperties = {
  ...statusBaseStyle,
  color: "var(--color-text-emphasis)",
};

const placeholderStyle: CSSProperties = {
  padding: "var(--space-4)",
  textAlign: "center",
  color: "var(--color-text-muted)",
  fontStyle: "italic",
  background: "var(--color-surface-subtle)",
  border: "1px dashed var(--color-border-strong)",
  borderRadius: "var(--radius-sm)",
};
