import type { ReactNode } from "react";

import { UnpublishedBadge } from "@/components/admin/UnpublishedBadge";

/**
 * Standard page-frame around a single admin panel. Holds the title +
 * description, leaves the body for the panel itself, and lets the
 * panel optionally render a sticky save bar at the bottom.
 *
 * Split into its own file (rather than colocated with `AdminShell`)
 * because client-rendered forms (`SiteSettingsForm`, `NavigationForm`,
 * `AppearanceForm`) only need this component — importing `AdminShell`
 * would drag in its server-only collection-listing code through the
 * client bundle.
 *
 * `hasPendingChanges` badges the title with "Unpublished" when the
 * panel's singleton has draft-vs-main edits — the form-surface
 * equivalent of the per-row badges on the list views.
 */

export function AdminPanel({
  title,
  description,
  children,
  saveBar,
  hasPendingChanges,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  saveBar?: ReactNode;
  hasPendingChanges?: boolean;
}) {
  return (
    <>
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "var(--space-8) var(--space-8)",
        }}
      >
        <header style={{ marginBottom: "var(--space-8)" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-3)",
            }}
          >
            <h1
              style={{
                fontSize: "1.5rem",
                fontWeight: "var(--font-weight-semibold)" as unknown as number,
                margin: 0,
              }}
            >
              {title}
            </h1>
            {hasPendingChanges ? <UnpublishedBadge /> : null}
          </div>
          {description ? (
            <p
              style={{
                fontSize: "var(--font-size-sm)",
                color: "var(--color-text-muted)",
                margin: "var(--space-1) 0 0 0",
                maxWidth: "var(--max-width-content)",
                lineHeight: "var(--line-height-base)",
              }}
            >
              {description}
            </p>
          ) : null}
        </header>
        <div style={{ maxWidth: "var(--max-width-content)" }}>{children}</div>
      </div>
      {saveBar}
    </>
  );
}
