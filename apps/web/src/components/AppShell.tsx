"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import styles from "./AppShell.module.css";

type NavKey = "sites" | "settings";

interface AppShellProps {
  user: { name?: string | null; email?: string | null };
  /** Highlights the active top-bar nav item. */
  current?: NavKey;
  children: React.ReactNode;
}

/**
 * Platform chrome: a sticky top bar (brand · nav · account) wrapping the
 * page content. Client component only for the mobile menu toggle; the
 * page content is passed through as `children` (server-rendered).
 */
export default function AppShell({ user, current, children }: AppShellProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const hamburgerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const label = user.name || user.email || "Account";

  // Mobile-menu keyboard handling. While open, focus lands on the first
  // item; Escape closes it and returns focus to the toggle; and Tab is
  // kept within the menu so focus can't slip behind it to page content.
  useEffect(() => {
    if (!menuOpen) return;

    const items = () =>
      Array.from(
        menuRef.current?.querySelectorAll<HTMLElement>("a[href], button:not([disabled])") ?? [],
      );

    items()[0]?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setMenuOpen(false);
        hamburgerRef.current?.focus();
        return;
      }
      if (event.key !== "Tab") return;
      const focusables = items();
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [menuOpen]);

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <Link className={styles.brand} href="/dashboard">
          <span className={styles.brandMark} aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path d="M3 9h18" />
            </svg>
          </span>
          Stagecraft
        </Link>

        <nav className={styles.nav} aria-label="Primary">
          <Link href="/dashboard" aria-current={current === "sites" ? "page" : undefined}>Sites</Link>
          <Link href="/settings" aria-current={current === "settings" ? "page" : undefined}>Settings</Link>
        </nav>

        <span className={styles.spacer} />

        <div className={styles.account}>
          <span className={styles.avatar} aria-hidden="true">{initials(label)}</span>
          <span className={styles.accountName}>{label}</span>
          {/* next-auth signout is an API route that 302s — force a full nav, not client routing */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a className={styles.signout} href="/api/auth/signout">Sign out</a>
        </div>

        <button
          type="button"
          ref={hamburgerRef}
          className={styles.hamburger}
          aria-label="Menu"
          aria-expanded={menuOpen}
          aria-controls="app-mobile-menu"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M3 6h18M3 12h18M3 18h18" />
          </svg>
        </button>
      </header>

      {menuOpen ? (
        <div className={styles.mobileMenu} id="app-mobile-menu" ref={menuRef}>
          <Link href="/dashboard" aria-current={current === "sites" ? "page" : undefined}>Sites</Link>
          <Link href="/settings" aria-current={current === "settings" ? "page" : undefined}>Settings</Link>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/api/auth/signout">Sign out</a>
        </div>
      ) : null}

      <main className={styles.content}>{children}</main>
    </div>
  );
}

/** First letters of up to two words, for the avatar. */
function initials(label: string): string {
  const parts = label.trim().split(/\s+/).slice(0, 2);
  const letters = parts.map((p) => p[0] ?? "").join("");
  return (letters || label[0] || "?").toUpperCase();
}
