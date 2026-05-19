/**
 * Puck custom inspector field that renders a "Manage <plural name> →"
 * link to the collection's admin surface (ADR-009 §5).
 *
 * Doesn't store anything — the field's value is ignored, the render
 * is the entire purpose. Puck inspector fields can be value-bearing
 * (text, select, custom-with-state) or value-less (this). We use
 * the custom-field render hook and accept the no-op onChange.
 */

"use client";

import type { CSSProperties } from "react";

export type ManageCollectionLinkProps = {
  collectionSlug: string;
  pluralName: string;
};

export function ManageCollectionLink({
  collectionSlug,
  pluralName,
}: ManageCollectionLinkProps) {
  return (
    <a
      href={`/admin/collections/${collectionSlug}`}
      style={linkStyle}
      title={`Edit ${pluralName} in the admin`}
    >
      Manage {pluralName} →
    </a>
  );
}

const linkStyle: CSSProperties = {
  display: "inline-block",
  padding: "var(--space-1) var(--space-3)",
  fontSize: "var(--font-size-xs)",
  fontWeight: "var(--font-weight-semibold)" as unknown as number,
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--color-border)",
  background: "var(--color-surface)",
  color: "var(--color-text)",
  textDecoration: "none",
};
