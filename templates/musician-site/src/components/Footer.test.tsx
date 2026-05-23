import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { Footer } from "./Footer";
import { DEFAULT_SITE_CONFIG } from "@/lib/site-config-types";

function renderFooter(siteOverride: Partial<typeof DEFAULT_SITE_CONFIG> = {}) {
  const site = { ...DEFAULT_SITE_CONFIG, ...siteOverride };
  return renderToStaticMarkup(<Footer site={site} />);
}

describe("<Footer>", () => {
  it("renders only the social links that have URLs set", () => {
    const html = renderFooter({
      socialLinks: {
        ...DEFAULT_SITE_CONFIG.socialLinks,
        instagram: "https://instagram.com/sarah",
        spotify: "https://open.spotify.com/artist/x",
      },
    });
    expect(html).toContain("https://instagram.com/sarah");
    expect(html).toContain("https://open.spotify.com/artist/x");
    expect(html).toContain("Instagram");
    expect(html).toContain("Spotify");
    // Empty platforms don't render.
    expect(html).not.toContain("Twitter");
    expect(html).not.toContain("Bandcamp");
  });

  it("omits the social-links list entirely when no platforms are set", () => {
    const html = renderFooter();
    // Default config has every platform as empty string.
    expect(html).not.toContain("Instagram");
    expect(html).not.toContain("Spotify");
  });

  it("renders the copyright line using artistName by default", () => {
    const html = renderFooter({ artistName: "Sarah Chen" });
    expect(html).toContain("Sarah Chen");
    expect(html).toContain("All rights reserved");
  });

  it("uses copyrightName when set", () => {
    const html = renderFooter({
      artistName: "Sarah Chen",
      copyrightName: "Riverside Records LLC",
    });
    expect(html).toContain("Riverside Records LLC");
    expect(html).not.toMatch(/©.+Sarah Chen/);
  });

  it("includes the current year", () => {
    const year = String(new Date().getFullYear());
    const html = renderFooter();
    expect(html).toContain(year);
  });

  it("social links open in a new tab with rel=noopener", () => {
    const html = renderFooter({
      socialLinks: {
        ...DEFAULT_SITE_CONFIG.socialLinks,
        bandcamp: "https://artist.bandcamp.com",
      },
    });
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
});
