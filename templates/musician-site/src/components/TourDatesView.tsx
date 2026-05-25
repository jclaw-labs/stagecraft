import type { CSSProperties } from "react";

/**
 * A tour-dates list embedded on a hand-authored page (e.g. the Home page's
 * "On the road" section). Unlike the old hardcoded rows, this is data-bound:
 * the public page server-component resolves the artist's real tour-dates
 * collection items and injects them (see lib/collections/resolve-page-collections).
 *
 * Pure + client-safe (no node imports) so the Puck block render in
 * src/puck/config.tsx can delegate to it.
 */

export type ResolvedTourDate = {
  /** ISO date string. */
  date: string;
  venue: string;
  city: string;
  country: string;
  /** Empty string when the artist hasn't set a tickets link. */
  ticketUrl: string;
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const weekday = d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  const month = d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  return `${weekday} · ${month} ${d.getUTCDate()}`;
}

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "var(--space-4)",
  padding: "var(--space-3) 0",
  borderBottom: "var(--rule-width, 1px) solid var(--rule-color, var(--color-border))",
};

const ticketStyle: CSSProperties = {
  flexShrink: 0,
  display: "inline-block",
  padding: "var(--space-1) var(--space-3)",
  borderRadius: "var(--btn-radius, var(--radius))",
  border: "1px solid var(--color-text)",
  color: "var(--color-text)",
  textDecoration: "none",
  fontSize: "var(--font-size-sm)",
  fontWeight: "var(--font-weight-semibold)" as unknown as number,
};

export function TourDatesList({ items }: { items: ResolvedTourDate[] }) {
  if (items.length === 0) {
    return (
      <p style={{ color: "var(--color-text-muted)", margin: 0 }}>
        No upcoming shows right now — check back soon.
      </p>
    );
  }
  return (
    <div>
      {items.map((d, i) => (
        <div key={i} style={i === items.length - 1 ? { ...rowStyle, borderBottom: "none" } : rowStyle}>
          <span>
            <strong>{formatDate(d.date)}</strong>
            {d.venue ? ` — ${d.venue}` : ""}
            {d.city ? ` — ${d.city}${d.country ? `, ${d.country}` : ""}` : ""}
          </span>
          {d.ticketUrl ? (
            <a href={d.ticketUrl} target="_blank" rel="noopener noreferrer" style={ticketStyle}>
              Tickets
            </a>
          ) : (
            <span style={{ ...ticketStyle, opacity: 0.5 }} aria-disabled="true">
              Tickets
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

/** Editor stand-in — the live data only resolves on the published page. */
export function TourDatesPlaceholder() {
  return (
    <div
      style={{
        padding: "var(--space-6)",
        border: "1px dashed var(--color-border)",
        borderRadius: "var(--radius)",
        color: "var(--color-text-muted)",
        textAlign: "center",
        fontSize: "var(--font-size-sm)",
      }}
    >
      Upcoming shows appear here — edit them in the Tour Dates panel.
    </div>
  );
}
