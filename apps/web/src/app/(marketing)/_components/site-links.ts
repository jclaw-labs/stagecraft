// Shared destinations for the public marketing surface. Used by the nav,
// footer, and in-page CTAs — keep a single source of truth here.

// TODO: confirm the public repository URL / visibility before launch — the
// "open source" pitch links here from the nav, footer, and homepage CTAs.
export const GITHUB_URL = "https://github.com/jclaw-labs/stagecraft";

export const SIGN_IN_HREF = "/login";

export type NavLink = { label: string; href: string };

export const PRIMARY_NAV: NavLink[] = [
  { label: "Examples", href: "/examples" },
  { label: "Migrate", href: "/migrate" },
];

export const LEGAL_NAV: NavLink[] = [
  { label: "Privacy", href: "/privacy" },
  { label: "Terms", href: "/terms" },
];
