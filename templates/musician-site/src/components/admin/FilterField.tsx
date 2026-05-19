/**
 * Puck custom field for authoring a Collection block's `Filter`
 * (ADR-009 §5.1).
 *
 * v1 is intentionally minimal: a textarea holding the filter as JSON
 * plus structured validation via `filterSchema.safeParse`. The
 * clause-builder UI the ADR sketches lives in a follow-up — this
 * surface is enough to unblock the Collection block and let
 * developer-mode artists configure filters end-to-end.
 *
 * Empty / whitespace input is treated as "no filter" — the resolver
 * accepts `null` / `undefined` filters and returns every item.
 */

"use client";

import { useState } from "react";
import type { CSSProperties } from "react";

// Import direct from the filter-schema submodule. `@/lib/collections`
// (barrel) pulls in `store.ts` → `node:fs`; `schema.ts` pulls in
// `node:crypto`. `filter-schema.ts` has no node imports, safe for
// client bundling.
import { filterSchema, type Filter } from "@/lib/collections/filter-schema";

export type FilterFieldProps = {
  /**
   * The Filter currently on the block (or null when unset / empty).
   * Puck supplies this via its custom-field render contract.
   */
  value: Filter | null;
  onChange: (next: Filter | null) => void;
};

export function FilterField({ value, onChange }: FilterFieldProps) {
  // Local text state so the artist can type partial JSON without
  // the parent's filter being repeatedly cleared. Re-parse on every
  // change and only call onChange when the parse succeeds (or the
  // input is empty).
  const [text, setText] = useState(() => (value ? JSON.stringify(value, null, 2) : ""));
  const [error, setError] = useState<string | null>(null);

  function handleChange(next: string) {
    setText(next);
    const trimmed = next.trim();
    if (trimmed === "") {
      onChange(null);
      setError(null);
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Invalid JSON");
      return;
    }
    const result = filterSchema.safeParse(parsed);
    if (!result.success) {
      setError(result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; "));
      return;
    }
    setError(null);
    onChange(result.data);
  }

  return (
    <div>
      <textarea
        value={text}
        onChange={(e) => handleChange(e.target.value)}
        placeholder='{ "all": [...] } or leave blank for no filter'
        rows={8}
        style={{
          ...textareaStyle,
          ...(error ? { borderColor: "var(--color-text-error)" } : {}),
        }}
        aria-invalid={error !== null}
      />
      {error ? (
        <div role="alert" style={errorStyle}>
          {error}
        </div>
      ) : (
        <div style={hintStyle}>
          Filter JSON per ADR §5.1. Leave blank to render every item.
        </div>
      )}
    </div>
  );
}

const textareaStyle: CSSProperties = {
  width: "100%",
  fontFamily: "var(--font-mono)",
  fontSize: "var(--font-size-xs)",
  padding: "var(--space-2)",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "var(--radius-sm)",
  background: "var(--color-surface)",
  color: "var(--color-text)",
  resize: "vertical",
};

const hintStyle: CSSProperties = {
  marginTop: "var(--space-1)",
  fontSize: "var(--font-size-xs)",
  color: "var(--color-text-muted)",
  lineHeight: "var(--line-height-base)",
};

const errorStyle: CSSProperties = {
  marginTop: "var(--space-1)",
  fontSize: "var(--font-size-xs)",
  color: "var(--color-text-error)",
  lineHeight: "var(--line-height-base)",
};
