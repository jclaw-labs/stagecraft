import type { CSSProperties } from "react";

/**
 * Degraded-mode notice shown in the admin chrome when the live `draft`
 * branch is unreachable (GitHub / broker outage) and the read store is
 * serving the container's last-published FS snapshot instead (ADR-010
 * §5 "Admin reads", deferred-work item). Rendered by `AdminShell` when
 * `getRequestReadStore().wasDegraded()` is true.
 *
 * Honest wording: reads degrade gracefully (stale-but-readable) and
 * saves fail rather than being hard-disabled — we don't claim editing
 * is blocked, only that it won't persist until the connection recovers.
 */

const bannerStyle: CSSProperties = {
  padding: "var(--space-3) var(--space-4)",
  background: "var(--color-surface-raised)",
  borderBottom: "1px solid var(--color-border)",
  borderLeft: "3px solid var(--color-danger)",
  fontSize: "var(--font-size-sm)",
  color: "var(--color-text)",
  lineHeight: "var(--line-height-base)",
};

const headingStyle: CSSProperties = {
  fontWeight: "var(--font-weight-semibold)" as unknown as number,
  color: "var(--color-text-emphasis)",
};

export function GitHubUnavailableBanner() {
  return (
    <div role="status" aria-live="polite" style={bannerStyle}>
      <span style={headingStyle}>GitHub is unavailable.</span> You&rsquo;re viewing the
      last published version — recent unpublished changes may be missing, and saves
      won&rsquo;t go through until the connection recovers.
    </div>
  );
}
