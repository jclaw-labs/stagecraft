import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

import { AdminAccountButton } from "./AdminAccountButton";

/**
 * The persistent admin chrome — left sidebar with section nav + signed-in
 * account menu, right pane for the active panel.
 *
 * Used by every admin route except `/admin/login` (which renders its own
 * minimal frame) and the Puck editor on `/admin/pages/[slug]` (which fills
 * the whole viewport so Puck owns the chrome).
 */

export type AdminSection =
  | "pages"
  | "settings"
  | "navigation"
  | "appearance"
  | "collections";

type Item = {
  href: string;
  label: string;
  section: AdminSection;
  description: string;
};

const ITEMS: Item[] = [
  { href: "/admin/pages", label: "Pages", section: "pages", description: "Add, remove, and edit the pages on your site." },
  { href: "/admin/settings", label: "Site Settings", section: "settings", description: "Artist name, social links, contact, copyright." },
  { href: "/admin/navigation", label: "Header & Navigation", section: "navigation", description: "Wordmark, header style, and which pages appear in the nav." },
  { href: "/admin/appearance", label: "Appearance", section: "appearance", description: "Colors and typography." },
  { href: "/admin/collections", label: "Collections", section: "collections", description: "Edit any collection's items directly (advanced)." },
];

const shellStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "16rem 1fr",
  minHeight: "100vh",
  background: "var(--color-surface-subtle)",
  color: "var(--color-text)",
  fontFamily: "var(--font-body)",
};

const sidebarStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  padding: "var(--space-6) var(--space-4)",
  background: "var(--color-surface)",
  borderRight: "1px solid var(--color-border)",
};

const mainStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  minWidth: 0,
};

const navListStyle: CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-1)",
  flex: 1,
};

function navItemStyle(isActive: boolean): CSSProperties {
  return {
    display: "block",
    padding: "var(--space-2) var(--space-3)",
    borderRadius: "var(--radius-sm)",
    background: isActive ? "var(--color-surface-raised)" : "transparent",
    color: isActive ? "var(--color-text)" : "var(--color-text-emphasis)",
    fontWeight: (isActive
      ? "var(--font-weight-semibold)"
      : "var(--font-weight-normal)") as unknown as number,
    fontSize: "var(--font-size-sm)",
    textDecoration: "none",
  };
}

export function AdminShell({
  activeSection,
  email,
  children,
}: {
  activeSection: AdminSection;
  email: string;
  children: ReactNode;
}) {
  return (
    <div style={shellStyle}>
      <aside style={sidebarStyle}>
        <Link
          href="/admin/pages"
          style={{
            fontSize: "var(--font-size-lg)",
            fontWeight: "var(--font-weight-semibold)" as unknown as number,
            color: "var(--color-text)",
            textDecoration: "none",
            marginBottom: "var(--space-6)",
          }}
        >
          Stagecraft
        </Link>
        <ul style={navListStyle}>
          {ITEMS.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                style={navItemStyle(item.section === activeSection)}
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
        <div style={{ marginTop: "var(--space-6)" }}>
          <Link
            href="/"
            style={{
              display: "block",
              fontSize: "var(--font-size-xs)",
              color: "var(--color-text-muted)",
              textDecoration: "none",
              marginBottom: "var(--space-3)",
            }}
          >
            ↗ View live site
          </Link>
          <AdminAccountButton email={email} />
        </div>
      </aside>
      <main style={mainStyle}>{children}</main>
    </div>
  );
}

/**
 * Standard page-frame around a single admin panel. Holds the title +
 * description, leaves the body for the panel itself, and lets the panel
 * optionally render a sticky save bar at the bottom.
 */
export function AdminPanel({
  title,
  description,
  children,
  saveBar,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  saveBar?: ReactNode;
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
          <h1
            style={{
              fontSize: "1.5rem",
              fontWeight: "var(--font-weight-semibold)" as unknown as number,
              margin: 0,
            }}
          >
            {title}
          </h1>
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
