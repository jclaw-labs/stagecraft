import type { CSSProperties } from "react";

import {
  SOCIAL_PLATFORMS,
  SOCIAL_PLATFORM_LABELS,
  type SiteConfig,
} from "@/lib/site-config-types";

type Props = {
  site: SiteConfig;
};

/**
 * Public site footer. Renders the active social links (any field set to a
 * URL) and the copyright line. The artist name + contact email come from
 * site.json; the copyright holder defaults to the artist name when
 * `copyrightName` is blank.
 */
export function Footer({ site }: Props) {
  const year = new Date().getFullYear();
  const holder = site.copyrightName.trim().length > 0 ? site.copyrightName : site.artistName;

  const activeLinks = SOCIAL_PLATFORMS
    .map((platform) => ({ platform, url: site.socialLinks[platform] }))
    .filter((s) => s.url && s.url.length > 0);

  const wrapperStyle: CSSProperties = {
    width: "100%",
    borderTop: "1px solid var(--color-border)",
    background: "var(--color-surface)",
    color: "var(--color-text-muted)",
    padding: "var(--space-8) var(--space-4)",
    marginTop: "var(--space-16)",
  };

  return (
    <footer style={wrapperStyle}>
      <div
        style={{
          maxWidth: "var(--max-width-wide)",
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "var(--space-4)",
          textAlign: "center",
          fontSize: "var(--font-size-sm)",
        }}
      >
        {activeLinks.length > 0 ? (
          <ul
            style={{
              display: "flex",
              flexWrap: "wrap",
              justifyContent: "center",
              listStyle: "none",
              margin: 0,
              padding: 0,
              gap: "var(--space-3)",
            }}
          >
            {activeLinks.map(({ platform, url }) => (
              <li key={platform}>
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "var(--color-text)", textDecoration: "none" }}
                >
                  {SOCIAL_PLATFORM_LABELS[platform]}
                </a>
              </li>
            ))}
          </ul>
        ) : null}
        <div>
          © {year} {holder}. All rights reserved.
        </div>
      </div>
    </footer>
  );
}
