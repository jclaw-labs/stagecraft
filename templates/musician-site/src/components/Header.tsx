import Link from "next/link";
import type { CSSProperties } from "react";

import { Image as PublicImage } from "@/components/Image";
import {
  isStickyHeader,
  isTransparentHeader,
  type HeaderConfig,
  type HeaderLayout,
} from "@/lib/site-config-types";

/**
 * Public site header. Renders the artist name (or wordmark image) + the
 * navigation links configured in `header.json`. The visual chrome — sticky,
 * solid vs transparent, layout — is driven by the same header config.
 *
 * All page slugs are looked up in a `pageTitleBySlug` map so renaming a
 * page from the editor immediately changes the nav label too.
 */

const WORDMARK_HEIGHT_BY_ADJUST: Record<string, string> = {
  "-2": "1.4rem",
  "-1": "1.7rem",
  "0": "2rem",
  "1": "2.4rem",
  "2": "2.8rem",
};

type Props = {
  artistName: string;
  header: HeaderConfig;
  /**
   * Ordered list of page slugs to render in the nav. Already filtered for
   * visibility / splash pages by the caller — Header is a pure renderer.
   */
  navItems: readonly string[];
  pageTitleBySlug: Map<string, string>;
};

export function Header({ artistName, header, navItems, pageTitleBySlug }: Props) {
  const wrapperStyle: CSSProperties = {
    width: "100%",
    background: isTransparentHeader(header.headerMode)
      ? "transparent"
      : "var(--color-surface)",
    color:
      isTransparentHeader(header.headerMode) && header.headerForegroundColor.length > 0
        ? header.headerForegroundColor
        : "var(--color-text)",
    borderBottom: isTransparentHeader(header.headerMode)
      ? "none"
      : "1px solid var(--color-border)",
    position: isStickyHeader(header.headerMode) ? "sticky" : "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 50,
  };

  const innerStyle: CSSProperties = {
    maxWidth: "var(--max-width-wide)",
    margin: "0 auto",
    padding: "var(--space-4)",
    ...layoutStyle(header.headerLayout),
  };

  const brand = header.wordmark ? (
    <Link href="/" aria-label={artistName} style={{ display: "inline-flex", alignItems: "center" }}>
      <span
        style={{
          display: "inline-block",
          height:
            WORDMARK_HEIGHT_BY_ADJUST[String(header.wordmarkSizeAdjust)] ?? "2rem",
        }}
      >
        <PublicImage image={header.wordmark} sizes={`(max-width: 768px) 50vw, 25vw`} />
      </span>
    </Link>
  ) : (
    <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.2 }}>
      <Link
        href="/"
        style={{
          color: "inherit",
          textDecoration: "none",
          fontSize: "var(--font-size-lg)",
          fontWeight: "var(--font-weight-semibold)" as unknown as number,
          letterSpacing: header.isHeaderTextUppercase ? "0.08em" : undefined,
          textTransform: header.isHeaderTextUppercase ? "uppercase" : undefined,
        }}
      >
        {artistName}
      </Link>
      {header.headerSubtitle ? (
        <span
          style={{
            fontSize: "var(--font-size-xs)",
            color: "var(--color-text-muted)",
          }}
        >
          {header.headerSubtitle}
        </span>
      ) : null}
    </div>
  );

  const nav = (
    <nav aria-label="Primary">
      <ul
        style={{
          display: "flex",
          listStyle: "none",
          margin: 0,
          padding: 0,
          gap: "var(--space-4)",
          fontSize: "var(--font-size-sm)",
        }}
      >
        {navItems.map((slug) => (
          <li key={slug}>
            <Link
              href={`/${slug}`}
              style={{
                color: "inherit",
                textDecoration: "none",
                padding: "var(--space-1) var(--space-2)",
              }}
            >
              {pageTitleBySlug.get(slug) ?? slug}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );

  return (
    <header style={wrapperStyle}>
      <div style={innerStyle}>
        {renderByLayout(header.headerLayout, brand, nav)}
      </div>
    </header>
  );
}

function layoutStyle(layout: HeaderLayout): CSSProperties {
  switch (layout) {
    case "logo-left-nav-right":
      return {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "var(--space-4)",
      };
    case "logo-center-nav-below":
      return {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "var(--space-2)",
      };
    case "logo-center-nav-split":
      // split layout uses a 3-column grid (left half nav | logo | right half nav),
      // but we collapse to centered-with-nav-below as a fallback when nav has
      // few enough items that splitting feels noisy. Implementation keeps it
      // simple: nav above logo for split too.
      return {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "var(--space-2)",
      };
  }
}

function renderByLayout(
  layout: HeaderLayout,
  brand: React.ReactNode,
  nav: React.ReactNode,
): React.ReactNode {
  if (layout === "logo-left-nav-right") {
    return (
      <>
        {brand}
        {nav}
      </>
    );
  }
  // centered variants: brand first then nav, both centered by the layout style.
  return (
    <>
      {brand}
      {nav}
    </>
  );
}
