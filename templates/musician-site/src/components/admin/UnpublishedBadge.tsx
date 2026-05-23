/**
 * "Unpublished" pill for an admin list row whose item has pending
 * draft-vs-main changes. Presentational only — no "use client" — so it
 * renders identically in the Pages panel (a client island) and the
 * generic collection list (a server component).
 */

const badgeStyle: React.CSSProperties = {
  fontSize: "var(--font-size-xs)",
  fontWeight: "var(--font-weight-semibold)" as unknown as number,
  color: "var(--color-text-emphasis)",
  padding: "var(--space-1) var(--space-2)",
  background: "var(--color-surface-raised)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-sm)",
  whiteSpace: "nowrap",
};

export function UnpublishedBadge() {
  return (
    <span title="Has unpublished changes" style={badgeStyle}>
      Unpublished
    </span>
  );
}
