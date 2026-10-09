import Link from "next/link";
import type { CSSProperties } from "react";

import { Image as PublicImage } from "@/components/Image";
import {
  isGlassHeader,
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
  const transparent = isTransparentHeader(header.headerMode);
  const glass = isGlassHeader(header.headerMode);
  // Border + height follow the theme's header chrome (defaulted when unset).
  const borderKind = header.headerBorder ?? "hairline";
  const borderBottom =
    transparent || borderKind === "none"
      ? "none"
      : borderKind === "bold"
        ? "3px solid var(--color-border)"
        : borderKind === "accent"
          ? "var(--border-width-thick) solid var(--color-accent)"
          : "var(--border-width) solid var(--color-border)";
  const headerHeight = header.headerHeight ?? "standard";
  const headerPad =
    headerHeight === "compact"
      ? "var(--space-3) var(--space-4)"
      : headerHeight === "tall"
        ? "var(--space-6) var(--space-4)"
        : "var(--space-4)";
  const wrapperStyle: CSSProperties = {
    width: "100%",
    background: transparent
      ? "transparent"
      : glass
        ? "color-mix(in srgb, var(--color-surface) 72%, transparent)"
        : "var(--color-surface)",
    color:
      transparent && header.headerForegroundColor.length > 0
        ? header.headerForegroundColor
        : "var(--color-text)",
    borderBottom,
    backdropFilter: glass ? "blur(14px)" : undefined,
    WebkitBackdropFilter: glass ? "blur(14px)" : undefined,
    // Header stays in normal flow (sticky or relative) so it reserves its
    // own height — never overlaps or hides the top of the page content.
    // (It used to be `absolute` when non-sticky, which collided with the
    // hero on a contained layout; a true full-bleed image overlay would be
    // a separate splash mode.)
    position: isStickyHeader(header.headerMode) ? "sticky" : "relative",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 50,
  };

  const innerStyle: CSSProperties = {
    maxWidth: "var(--max-width-wide)",
    margin: "0 auto",
    padding: headerPad,
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

  const navList = (
    items: readonly string[],
    justify: "flex-start" | "center" | "flex-end",
  ) => (
    <nav aria-label="Primary">
      <ul
        style={{
          display: "flex",
          // Wrap onto a second row rather than overflow on narrow screens.
          flexWrap: "wrap",
          listStyle: "none",
          margin: 0,
          padding: 0,
          gap: "var(--space-2) var(--space-4)",
          fontSize: "var(--font-size-sm)",
          justifyContent: justify,
        }}
      >
        {items.map((slug) => (
          <li key={slug}>
            <Link
              href={`/${slug}`}
              style={{
                color: "inherit",
                textDecoration: "none",
                padding: "var(--space-1) var(--space-2)",
                letterSpacing: "var(--tracking-wide)",
                textTransform: header.isHeaderTextUppercase ? "uppercase" : undefined,
              }}
            >
              {pageTitleBySlug.get(slug) ?? slug}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );

  let inner: React.ReactNode;
  if (header.headerLayout === "logo-center-nav-split") {
    // Real split: nav-left | logo-center | nav-right (3-col grid via
    // layoutStyle). The nav items divide into two halves.
    const mid = Math.ceil(navItems.length / 2);
    inner = (
      <>
        {navList(navItems.slice(0, mid), "flex-start")}
        {brand}
        {navList(navItems.slice(mid), "flex-end")}
      </>
    );
  } else if (header.headerLayout === "logo-left-nav-right") {
    inner = (
      <>
        {brand}
        {navList(navItems, "flex-end")}
      </>
    );
  } else {
    // logo-center-nav-below
    inner = (
      <>
        {brand}
        {navList(navItems, "center")}
      </>
    );
  }

  return (
    <header style={wrapperStyle}>
      <div style={innerStyle}>{inner}</div>
    </header>
  );
}

function layoutStyle(layout: HeaderLayout): CSSProperties {
  switch (layout) {
    case "logo-left-nav-right":
      return {
        display: "flex",
        // When the nav doesn't fit beside the logo, it drops to its own row.
        flexWrap: "wrap",
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
      // 3-column grid: left-half nav | centered logo | right-half nav.
      return {
        display: "grid",
        gridTemplateColumns: "1fr auto 1fr",
        alignItems: "center",
        gap: "var(--space-4)",
      };
  }
}
