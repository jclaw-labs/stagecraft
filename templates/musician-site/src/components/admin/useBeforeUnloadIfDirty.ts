/**
 * Hook: warn the artist before they leave the page if there are
 * unsaved edits. Subscribes to `beforeunload` only while `isDirty`
 * is true, so the browser only shows its confirm dialog when there's
 * actually something to lose.
 *
 * Caveat: `beforeunload` only fires for full navigations (closing
 * the tab, hitting back, typing a new URL, refresh). Next.js App
 * Router client-side navigations (`<Link>` clicks, `router.push`)
 * are intentionally not covered — the App Router doesn't expose a
 * stable navigation-block hook, and the common workarounds
 * (intercepting link clicks, monkey-patching history) are fragile.
 * The artist's biggest risk is the full-navigation case, so we
 * cover it and accept the in-app gap.
 *
 * `e.returnValue = ""` is the required-by-Chrome incantation to
 * trigger the confirm. The browser shows its own generic message —
 * the string we set is ignored in every modern browser, but we have
 * to set it or the dialog doesn't appear.
 */

import { useEffect } from "react";

export function useBeforeUnloadIfDirty(isDirty: boolean): void {
  useEffect(() => {
    if (!isDirty) return;
    function handler(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);
}
