"use client";

import { useEffect, useRef, useState } from "react";

import { PhotoLightbox, type LightboxImage } from "./PhotoLightbox";

/**
 * Page-level bootstrap for the photo lightbox. Sits at the public
 * layout's root; on mount it walks the DOM for photo galleries
 * (`[data-collection-view="photos"]`) and attaches a single click
 * delegate per gallery.
 *
 * Click flow
 * ----------
 *   1. Artist's reader clicks a `[data-photo-tile]` anchor.
 *   2. Delegate intercepts: `preventDefault()` (the anchor's
 *      `href="...original.jpg"` is the JS-disabled fallback — with
 *      JS we want the modal instead of a navigation to the raw
 *      file).
 *   3. Boot builds the gallery's image list from sibling tiles'
 *      data-attributes, identifies the clicked index, opens the
 *      `<PhotoLightbox>`.
 *
 * Why delegation instead of per-tile React handlers
 * -------------------------------------------------
 * The tiles are server-rendered through the collection-block
 * pipeline — they're not React components on the client side, so
 * we can't hand them props directly. Click delegation on a parent
 * gives us a single hook that picks up any tile rendered server-
 * side, including dynamic gallery insertions after hydration.
 *
 * Why not put the boot inside `PhotosView`
 * ----------------------------------------
 * `PhotosView` is server-rendered and shouldn't carry client
 * state. Mounting the boot once at the layout level keeps the
 * gallery components pure server components AND avoids one
 * `<PhotoLightbox>` instance per gallery on the page.
 *
 * Focus restoration
 * -----------------
 * Saved before opening; restored on close. Otherwise after
 * closing the modal the user's focus lands somewhere unpredictable
 * (often the document body), which on touch and keyboard is
 * disorienting.
 *
 * Re-scan on DOM updates
 * ----------------------
 * For v1 we attach handlers once on mount. Dynamic gallery
 * insertions after hydration (the gallery editor's preview pane,
 * say) wouldn't get handlers. The public site doesn't do dynamic
 * insertions, so this is acceptable; a MutationObserver-based
 * re-scan can land if the use case appears.
 */
export function PhotoLightboxBoot() {
  const [state, setState] = useState<
    | { kind: "closed" }
    | { kind: "open"; images: LightboxImage[]; initialIndex: number }
  >({ kind: "closed" });

  // Element that owned focus before open. We refocus it on close
  // so screen-reader / keyboard users return to a deterministic
  // spot in the gallery.
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const galleries = document.querySelectorAll<HTMLElement>(
      '[data-collection-view="photos"]',
    );
    if (galleries.length === 0) return;

    const cleanups: Array<() => void> = [];
    for (const gallery of galleries) {
      cleanups.push(wireGallery(gallery, (next) => {
        restoreFocusRef.current = document.activeElement as HTMLElement | null;
        setState(next);
      }));
    }
    return () => {
      for (const cleanup of cleanups) cleanup();
    };
  }, []);

  function handleClose() {
    setState({ kind: "closed" });
    // Defer the focus restore one tick so the lightbox unmounts
    // first; otherwise the focus call races with React's removal
    // of the dialog and may land on the dialog momentarily.
    queueMicrotask(() => {
      restoreFocusRef.current?.focus();
    });
  }

  if (state.kind !== "open") return null;
  return (
    <PhotoLightbox
      images={state.images}
      initialIndex={state.initialIndex}
      onClose={handleClose}
    />
  );
}

/**
 * Attach click delegation to one gallery container. Returns a
 * cleanup callback the effect calls on unmount.
 *
 * Reads each tile's data attributes to build the lightbox image
 * list — declarative; no JSON parsing, no `<picture>` walking.
 */
function wireGallery(
  gallery: HTMLElement,
  open: (state: {
    kind: "open";
    images: LightboxImage[];
    initialIndex: number;
  }) => void,
): () => void {
  function handleClick(event: Event) {
    const target = event.target as HTMLElement | null;
    // Find the nearest tile anchor — clicks land on the inner
    // `<picture>` / `<img>` more often than the anchor itself.
    const anchor = target?.closest<HTMLAnchorElement>("[data-photo-tile]");
    if (!anchor) return;
    // Honour modifier-key clicks (cmd/ctrl/middle-click → open in
    // new tab); only intercept the plain click.
    if (
      (event as MouseEvent).metaKey ||
      (event as MouseEvent).ctrlKey ||
      (event as MouseEvent).shiftKey ||
      (event as MouseEvent).altKey ||
      (event as MouseEvent).button !== 0
    ) {
      return;
    }
    event.preventDefault();

    const tiles = Array.from(
      gallery.querySelectorAll<HTMLAnchorElement>("[data-photo-tile]"),
    );
    const initialIndex = tiles.indexOf(anchor);
    if (initialIndex === -1) return;
    const images: LightboxImage[] = tiles.map((tile) => ({
      // `getAttribute("href")` preserves the relative path the
      // artist authored (`/images/...`). The DOM property `.href`
      // resolves to an absolute URL (`http://host/images/...`) — same
      // bytes loaded, but the inline DevTools surface reads cleaner
      // when relative.
      url: tile.getAttribute("href") ?? "",
      alt: tile.dataset.photoAlt ?? "",
      caption: tile.dataset.photoCaption ?? "",
      credit: tile.dataset.photoCredit ?? "",
    }));
    open({ kind: "open", images, initialIndex });
  }

  gallery.addEventListener("click", handleClick);
  return () => gallery.removeEventListener("click", handleClick);
}
