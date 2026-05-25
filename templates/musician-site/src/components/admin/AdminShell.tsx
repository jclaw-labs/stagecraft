import Link from "next/link";
import { cache } from "react";
import type { CSSProperties, ReactNode } from "react";

import { AdminAccountButton } from "./AdminAccountButton";
import {
  CUSTOM_ADMIN_SURFACES,
  CUSTOM_PANEL_COLLECTION_SLUGS,
} from "./admin-surfaces";
import { DiscardPendingChangesLink } from "./DiscardPendingChangesLink";
import { GitHubUnavailableBanner } from "./GitHubUnavailableBanner";
import { PendingChangesIndicator } from "./PendingChangesIndicator";
import { PublishPendingChangesButton } from "./PublishPendingChangesButton";
import {
  getRequestReadStore,
  listCollectionSlugs,
  readCollectionDef,
  type CollectionDef,
} from "@/lib/collections";


/**
 * The persistent admin chrome — left sidebar with section nav + signed-in
 * account menu, right pane for the active panel.
 *
 * Used by every admin route except `/admin/login` (which renders its own
 * minimal frame) and the Puck editor on `/admin/pages/[slug]` (which fills
 * the whole viewport so Puck owns the chrome).
 *
 * Sidebar layout (ADR-009 follow-up):
 *
 *   1. **Custom panels** (top, sanctioned UX) — Pages, Site Settings,
 *      Header & Navigation, Appearance. Sourced from `CUSTOM_ADMIN_SURFACES`.
 *   2. **Collections** (below, under a header) — every other collection
 *      registered in `_collections.json`, listed alphabetically by
 *      plural name. Each links to the generic
 *      `/admin/collections/<slug>` list view.
 *
 * Custom-panel collections are filtered out of the Collections group so
 * Site Settings doesn't appear twice. Adding a new custom panel is
 * registry-only (entry in `admin-surfaces.ts`); the sidebar picks it up
 * automatically.
 */

const cachedListCollectionSlugs = cache(listCollectionSlugs);
const cachedReadCollectionDef = cache(readCollectionDef);

/** What the rendered Collections sidebar entry needs to know. */
type CollectionSidebarEntry = {
  slug: string;
  pluralName: string;
  isSingleton: boolean;
};

/**
 * Load every non-custom-panel collection for the sidebar's lower
 * group. Cached per-request so the sidebar costs one fs walk regardless
 * of which admin page renders it.
 */
const cachedGenericCollections = cache(async (): Promise<CollectionSidebarEntry[]> => {
  const slugs = await cachedListCollectionSlugs();
  const defs = await Promise.all(slugs.map((s) => cachedReadCollectionDef(s)));
  return defs
    .filter((d): d is CollectionDef => d !== null)
    .filter((d) => !CUSTOM_PANEL_COLLECTION_SLUGS.has(d.slug))
    .map((d) => ({
      slug: d.slug,
      pluralName: d.pluralName,
      isSingleton: d.isSingleton,
    }))
    .sort((a, b) => a.pluralName.localeCompare(b.pluralName));
});

export type AdminSection =
  | "pages"
  | "settings"
  | "navigation"
  | "appearance"
  | "collections"
  | `collection:${string}`;

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
};

const groupHeadingStyle: CSSProperties = {
  margin: "var(--space-5) 0 var(--space-2) var(--space-3)",
  fontSize: "var(--font-size-xs)",
  fontWeight: "var(--font-weight-semibold)" as unknown as number,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  color: "var(--color-text-muted)",
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

export async function AdminShell({
  activeSection,
  email,
  children,
}: {
  activeSection: AdminSection;
  email: string;
  children: ReactNode;
}) {
  const genericCollections = await cachedGenericCollections();
  // Same per-request store the page already read through (React.cache),
  // so the flag reflects this request's reads. On a page that did no
  // content reads this also surfaces a broker-unreachable token mint.
  // Never let the degraded check break the chrome: if even building the
  // store throws (e.g. a permanent broker-rejected misconfig), just
  // don't show the banner — the page's own reads surface that error.
  let isDegraded = false;
  try {
    isDegraded = (await getRequestReadStore()).wasDegraded();
  } catch {
    isDegraded = false;
  }

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
          {CUSTOM_ADMIN_SURFACES.map((surface) => (
            <li key={surface.collectionSlug}>
              <Link
                href={surface.route}
                style={navItemStyle(surface.section === activeSection)}
              >
                {surface.label}
              </Link>
            </li>
          ))}
        </ul>
        {/*
          The Collections group header + the "+ New collection" link
          render unconditionally so the create-a-collection entry point
          is always reachable, even on a fresh site with no custom
          collections yet. The collection list below only appears once
          the artist has added one.
        */}
        <div style={groupHeadingStyle}>Collections</div>
        <ul style={navListStyle}>
          {genericCollections.map((c) => {
            const section: AdminSection = `collection:${c.slug}`;
            // Singletons go straight to the item; multi-item
            // collections to the list view.
            const href = c.isSingleton
              ? `/admin/collections/${c.slug}/items/_singleton`
              : `/admin/collections/${c.slug}`;
            return (
              <li key={c.slug}>
                <Link href={href} style={navItemStyle(section === activeSection)}>
                  {c.pluralName}
                </Link>
              </li>
            );
          })}
          <li>
            <Link
              href="/admin/collections/new"
              style={{
                ...navItemStyle(activeSection === "collections"),
                color:
                  activeSection === "collections"
                    ? "var(--color-text)"
                    : "var(--color-text-muted)",
              }}
            >
              + New collection
            </Link>
          </li>
        </ul>
        <div style={{ marginTop: "auto", paddingTop: "var(--space-6)" }}>
          <PendingChangesIndicator />
          <PublishPendingChangesButton isDegraded={isDegraded} />
          <DiscardPendingChangesLink isDegraded={isDegraded} />
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
      <main style={mainStyle}>
        {isDegraded ? <GitHubUnavailableBanner /> : null}
        {children}
      </main>
    </div>
  );
}

