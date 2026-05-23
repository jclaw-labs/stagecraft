"use client";

/**
 * Custom Puck field for the NewsletterSignup block's `actionUrl`.
 *
 * Renders a plain text input PLUS an author-time validation hint
 * that surfaces under the input when the pasted URL doesn't match
 * the selected provider's expected shape. Catches the silent-failure
 * mode where (e.g.) a Mailchimp URL missing `?u=...&id=...` posts
 * fine but bypasses the bot defense — the artist would have no
 * indication until checking their list dashboard days later.
 *
 * The validation function (`validateNewsletterActionUrl`) lives in
 * `components/newsletter-types.ts` so it's pure / testable / shared
 * with potential future surfaces.
 *
 * `usePuck()` is the bridge to the sibling `service` field's current
 * value — Puck's custom-field render only receives this field's own
 * `value`/`onChange`, but the field's hint depends on which provider
 * is selected. The same pattern is used by `BlockHelp` in the editor
 * shell (look up the selected item via `selectedItem`).
 */

import { usePuck } from "@measured/puck";
import type { CSSProperties } from "react";

import {
  validateNewsletterActionUrl,
  type NewsletterService,
} from "@/components/newsletter-types";

type Props = {
  id: string;
  name: string;
  label?: string;
  value: string;
  onChange: (next: string) => void;
  readOnly?: boolean;
};

export function NewsletterUrlField({
  id,
  name,
  label,
  value,
  onChange,
  readOnly,
}: Props) {
  const { selectedItem } = usePuck();
  // The selected block's `service` prop drives validation. When the
  // selection is somehow stale (block deleted mid-edit), fall back
  // to `generic` — which only validates URL parseability and won't
  // produce a misleading provider-specific hint.
  const service =
    (selectedItem?.props as { service?: NewsletterService } | undefined)
      ?.service ?? "generic";
  const result = validateNewsletterActionUrl(service, value);
  return (
    <div>
      {label ? (
        <label htmlFor={id} style={labelStyle}>
          {label}
        </label>
      ) : null}
      <input
        id={id}
        name={name}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        readOnly={readOnly}
        style={inputStyle}
        aria-invalid={!result.ok || undefined}
        aria-describedby={result.ok ? undefined : `${id}-hint`}
      />
      {result.ok ? null : (
        <p id={`${id}-hint`} role="status" style={hintStyle}>
          {result.message}
        </p>
      )}
    </div>
  );
}

// Match Puck's native field-label chrome: small label-cap above the
// control. Plain `<label>` (no surrounding wrapper) is sufficient —
// Puck renders custom fields inside its own Field group, so we only
// need the text + spacing here.
const labelStyle: CSSProperties = {
  display: "block",
  marginBottom: "var(--space-1)",
  fontSize: "var(--font-size-xs)",
  fontWeight: "var(--font-weight-semibold)" as unknown as number,
  color: "var(--color-text)",
};

// Plain-styled input — Puck's chrome already supplies the surrounding
// label + spacing via `FieldLabel`, so we only need the bare control.
// Matching token-set as the editor's text inputs elsewhere
// (border / radius / padding mirror Puck's default field controls so
// the swap feels native).
const inputStyle: CSSProperties = {
  width: "100%",
  padding: "var(--space-2) var(--space-3)",
  fontSize: "var(--font-size-sm)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-sm)",
  background: "var(--color-surface)",
  color: "var(--color-text)",
};

// Hint card — neutral surface + muted body, since the URL is still
// usable (the form will post; we're warning about a missed bot
// defense / mismatched embed pattern, not a hard failure).
// `role="status"` so AT users get the hint when it appears, but
// without an alert's urgency.
const hintStyle: CSSProperties = {
  margin: "var(--space-2) 0 0 0",
  padding: "var(--space-2) var(--space-3)",
  background: "var(--color-surface-subtle)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-sm)",
  color: "var(--color-text-muted)",
  fontSize: "var(--font-size-xs)",
  lineHeight: "var(--line-height-base)",
};
