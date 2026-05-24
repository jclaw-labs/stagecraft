import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { TourDatesList, TourDatesPlaceholder, type ResolvedTourDate } from "./TourDatesView";

function row(over: Partial<ResolvedTourDate> = {}): ResolvedTourDate {
  return {
    date: "2026-06-18T20:00:00.000Z",
    venue: "Mercury Lounge",
    city: "New York",
    country: "United States",
    ticketUrl: "",
    ...over,
  };
}

describe("<TourDatesList>", () => {
  it("renders venue, city, country and a formatted date", () => {
    const html = renderToStaticMarkup(<TourDatesList items={[row()]} />);
    expect(html).toContain("Mercury Lounge");
    expect(html).toContain("New York");
    expect(html).toContain("United States");
    // formatDate → "Thu · Jun 18" for 2026-06-18 (UTC).
    expect(html).toMatch(/Jun 18/);
  });

  it("renders a real Tickets link when a ticketUrl is set", () => {
    const html = renderToStaticMarkup(
      <TourDatesList items={[row({ ticketUrl: "https://tix.example/show" })]} />,
    );
    expect(html).toContain('href="https://tix.example/show"');
    expect(html).toContain("Tickets");
  });

  it("renders a non-link (disabled) Tickets label when no ticketUrl is set", () => {
    const html = renderToStaticMarkup(<TourDatesList items={[row({ ticketUrl: "" })]} />);
    expect(html).toContain("Tickets");
    expect(html).not.toContain("<a");
  });

  it("shows an empty state when there are no shows", () => {
    const html = renderToStaticMarkup(<TourDatesList items={[]} />);
    expect(html).toMatch(/No upcoming shows/i);
  });
});

describe("<TourDatesPlaceholder>", () => {
  it("renders the editor stand-in copy", () => {
    const html = renderToStaticMarkup(<TourDatesPlaceholder />);
    expect(html).toMatch(/Upcoming shows appear here/i);
  });
});
