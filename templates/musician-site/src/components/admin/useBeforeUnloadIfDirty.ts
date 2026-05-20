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
 *
 * The full-navigation case is the most user-affecting (closing the
 * tab loses everything); the in-app case is a smaller leak (next
 * page mounts; localStorage usually retains the edit-buffer for
 * recovery on return). Accept the gap until the App Router exposes
 * a stable navigation-block primitive.
 *
 * TODO: revisit when Next.js ships a stable `useBlocker`-style hook
 * (tracked at vercel/next.js#41058 and similar). Until then, a
 * future iteration could intercept `<Link>` clicks within the admin
 * shell at the layout level — but that's a much bigger lift than
 * this hook and shouldn't pretend to be solved here.
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
