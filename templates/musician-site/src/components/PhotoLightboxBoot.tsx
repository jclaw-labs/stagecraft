"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

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
 * A `MutationObserver` watching `document.body` picks up galleries
 * inserted after the boot mounts (e.g. the gallery editor's preview
 * pane, future client-side filters). New `[data-collection-view=
 * "photos"]` nodes get a fresh click delegate; removed ones get
 * their listener cleaned up so detached DOM doesn't keep references
 * to the boot's state. Initial-mount scan is still the fast path
 * (no observer round-trip on first paint).
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
    const GALLERY_SELECTOR = '[data-collection-view="photos"]';
    // Track wired galleries so the observer can cleanly add /
    // remove handlers as DOM changes. A WeakMap would suffice for
    // GC of detached galleries, but `Map` lets the cleanup phase
    // iterate every wired entry.
    const wired = new Map<HTMLElement, () => void>();

    function wire(gallery: HTMLElement) {
      if (wired.has(gallery)) return;
      wired.set(
        gallery,
        wireGallery(gallery, (next) => {
          restoreFocusRef.current = document.activeElement as HTMLElement | null;
          setState(next);
        }),
      );
    }

    function unwire(gallery: HTMLElement) {
      const cleanup = wired.get(gallery);
      if (!cleanup) return;
      cleanup();
      wired.delete(gallery);
    }

    // Initial scan — typical static-site case where galleries are
    // server-rendered into the initial HTML.
    document.querySelectorAll<HTMLElement>(GALLERY_SELECTOR).forEach(wire);

    // Watch the document for dynamically-inserted galleries. The
    // observer fires on EVERY DOM change in the subtree (text
    // inserts, React commits elsewhere on the page, etc.) — but
    // each batch is cheap because we filter aggressively to our
    // gallery selector.
    //
    // `subtree: true, childList: true` only — we don't react to
    // attribute mutations. In practice a gallery is rendered with
    // its `data-collection-view` attribute already set; a div that
    // gets the attribute added later won't get wired. Acceptable
    // trade for the rarer-than-rare case.
    //
    // `instanceof HTMLElement` rejects `SVGElement` / `MathMLElement`
    // / DocumentFragment etc. Galleries are always HTML `<div>`s so
    // narrowing here is intended.
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;
          if (node.matches(GALLERY_SELECTOR)) wire(node);
          // The added node might CONTAIN a gallery (e.g. a section
          // wrapper with a photo grid inside).
          node.querySelectorAll<HTMLElement>(GALLERY_SELECTOR).forEach(wire);
        }
        for (const node of mutation.removedNodes) {
          if (!(node instanceof HTMLElement)) continue;
          if (wired.has(node)) unwire(node);
          // Removed wrappers may contain wired galleries; iterate
          // the wired map to catch them. `node.querySelectorAll`
          // works on detached subtrees too.
          node.querySelectorAll<HTMLElement>(GALLERY_SELECTOR).forEach(unwire);
        }
      }
    });
    observer.observe(document.body, { subtree: true, childList: true });

    return () => {
      observer.disconnect();
      for (const cleanup of wired.values()) cleanup();
      wired.clear();
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

  // While the lightbox is open, mark `.stagecraft-site` (the
  // layout's wrapper around the page content) as `inert` so
  // assistive tech doesn't traverse the background. The lightbox
  // itself is portalled to `document.body`, so it sits OUTSIDE
  // the inert subtree.
  //
  // The WAI-ARIA modal pattern requires the rest of the document
  // to be unreachable from a screen-reader's virtual cursor while
  // a modal is open — the keyboard focus trap inside the modal
  // only helps Tab-key users; browsing-mode users (NVDA, JAWS,
  // VoiceOver web rotor) can otherwise scroll past it.
  useEffect(() => {
    if (state.kind !== "open") return;
    const wrapper = document.querySelector<HTMLElement>(".stagecraft-site");
    if (!wrapper) return;
    const hadInert = wrapper.inert;
    wrapper.inert = true;
    return () => {
      wrapper.inert = hadInert;
    };
  }, [state.kind]);

  if (state.kind !== "open") return null;
  // Portal to document.body so the lightbox sits outside the
  // inert wrapper. Without this, the modal would be a descendant
  // of `.stagecraft-site` (which we just made inert) and become
  // inert itself.
  if (typeof document === "undefined") return null;
  return createPortal(
    <PhotoLightbox
      images={state.images}
      initialIndex={state.initialIndex}
      onClose={handleClose}
    />,
    document.body,
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
      // Intrinsic source dimensions. The fallback to 0 covers
      // older tiles without the attrs (or stale content shape);
      // the lightbox skips the `width`/`height` attributes when
      // either is 0, accepting the potential CLS flash rather
      // than crashing.
      width: parseDimension(tile.dataset.photoWidth),
      height: parseDimension(tile.dataset.photoHeight),
    }));
    open({ kind: "open", images, initialIndex });
  }

  gallery.addEventListener("click", handleClick);
  return () => gallery.removeEventListener("click", handleClick);
}

/**
 * Parse a `data-photo-width` / `data-photo-height` attribute. Returns
 * 0 for missing / malformed input — the lightbox falls back to
 * dimension-less rendering rather than throwing.
 */
function parseDimension(raw: string | undefined): number {
  if (!raw) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}
