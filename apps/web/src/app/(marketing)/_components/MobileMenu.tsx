"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Button from "@/components/Button";
import { GITHUB_URL, PRIMARY_NAV, SIGN_IN_HREF } from "./site-links";
import styles from "./MarketingNav.module.css";

export default function MobileMenu() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // While open: close on Escape and on a click/tap outside the menu.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onPointerDown = (e: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  return (
    <div className={styles.mobile} ref={containerRef}>
      <button
        type="button"
        className={styles.hamburger}
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        aria-controls="marketing-mobile-menu"
        onClick={() => setOpen((v) => !v)}
      >
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          aria-hidden="true"
        >
          {open ? (
            <path d="M6 6L18 18M18 6L6 18" />
          ) : (
            <path d="M4 7h16M4 12h16M4 17h16" />
          )}
        </svg>
      </button>

      {open && (
        <div id="marketing-mobile-menu" className={styles.panel}>
          {PRIMARY_NAV.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={styles.panelLink}
              onClick={() => setOpen(false)}
            >
              {link.label}
            </Link>
          ))}
          <a
            href={GITHUB_URL}
            className={styles.panelLink}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
          >
            GitHub
          </a>
          <Button href={SIGN_IN_HREF} className={styles.panelButton}>
            Start building
          </Button>
        </div>
      )}
    </div>
  );
}
