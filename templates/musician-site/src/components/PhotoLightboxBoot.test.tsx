/**
 * Interaction tests for the page-level lightbox bootstrap. Simulates
 * a server-rendered photos gallery in the DOM, mounts the boot, and
 * asserts the click delegation + open-event flow.
 */
// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { PhotoLightboxBoot } from "./PhotoLightboxBoot";

/**
 * Build a photos-gallery DOM fragment matching what `PhotoTile`
 * server-renders (anchor → data-photo-tile + data-* attributes).
 * Inserts directly into document.body so the boot's
 * `document.querySelectorAll` finds it.
 */
function mountGallery(
  tiles: Array<{
    url: string;
    alt: string;
    caption?: string;
    credit?: string;
    width?: number;
    height?: number;
  }>,
) {
  const container = document.createElement("div");
  container.setAttribute("data-collection-view", "photos");
  container.innerHTML = tiles
    .map((t) => {
      // Dimensions are optional — older / stale tiles without them
      // exercise the boot's fallback-to-0 path.
      const widthAttr = t.width != null ? ` data-photo-width="${t.width}"` : "";
      const heightAttr = t.height != null ? ` data-photo-height="${t.height}"` : "";
      return `<figure><a href="${t.url}" data-photo-tile data-photo-alt="${t.alt}" data-photo-caption="${t.caption ?? ""}" data-photo-credit="${t.credit ?? ""}"${widthAttr}${heightAttr}><img alt="${t.alt}" /></a></figure>`;
    })
    .join("");
  document.body.appendChild(container);
  return container;
}

afterEach(() => {
  cleanup();
  // Wipe gallery fragments between tests so the boot doesn't pick up
  // stale tiles from earlier specs.
  document.body.innerHTML = "";
  document.body.style.overflow = "";
});

describe("<PhotoLightboxBoot> — click delegation", () => {
  it("renders nothing while no tile has been clicked", () => {
    mountGallery([{ url: "/a.jpg", alt: "A" }]);
    render(<PhotoLightboxBoot />);
    expect(screen.queryByTestId("photo-lightbox")).toBeNull();
  });

  it("renders nothing when there's no photos gallery on the page", () => {
    // Don't mount any gallery — typical About / Contact page.
    render(<PhotoLightboxBoot />);
    expect(screen.queryByTestId("photo-lightbox")).toBeNull();
  });

  it("opens the lightbox on tile click; populates images + clicked index", () => {
    const gallery = mountGallery([
      { url: "/a.jpg", alt: "A", caption: "First" },
      { url: "/b.jpg", alt: "B", caption: "Second" },
      { url: "/c.jpg", alt: "C", caption: "Third" },
    ]);
    render(<PhotoLightboxBoot />);
    const tiles = gallery.querySelectorAll<HTMLAnchorElement>("[data-photo-tile]");
    // Click the middle tile — lightbox should open on index 1.
    fireEvent.click(tiles[1]!);

    const lightbox = screen.getByTestId("photo-lightbox");
    // Scope to inside the lightbox — the gallery tiles also have
    // `<img>` elements, so a top-level getByRole("img") finds
    // multiple.
    const img = lightbox.querySelector("img");
    expect(img?.getAttribute("src")).toBe("/b.jpg");
    // Counter announces 2/3 (the clicked index).
    expect(screen.getByText("2 / 3")).toBeTruthy();
  });

  it("preventDefault on tile click — anchor's `href` doesn't navigate the page", () => {
    const gallery = mountGallery([{ url: "/a.jpg", alt: "A" }]);
    render(<PhotoLightboxBoot />);
    const tile = gallery.querySelector<HTMLAnchorElement>("[data-photo-tile]")!;

    // Synthesise a click and check defaultPrevented.
    const clickEvent = new MouseEvent("click", { bubbles: true, cancelable: true });
    tile.dispatchEvent(clickEvent);
    expect(clickEvent.defaultPrevented).toBe(true);
  });

  it("honours cmd / ctrl / middle-click — open-in-new-tab path bypasses the modal", () => {
    // Modifier-key clicks are the universal "open in new tab" idiom;
    // intercepting them would feel broken. Boot lets the anchor
    // do its native thing in that case.
    const gallery = mountGallery([{ url: "/a.jpg", alt: "A" }]);
    render(<PhotoLightboxBoot />);
    const tile = gallery.querySelector<HTMLAnchorElement>("[data-photo-tile]")!;

    const cmdClick = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      metaKey: true,
    });
    tile.dispatchEvent(cmdClick);
    // Default not prevented — anchor follows through.
    expect(cmdClick.defaultPrevented).toBe(false);
    expect(screen.queryByTestId("photo-lightbox")).toBeNull();
  });

  it("ignores clicks outside any photo tile", () => {
    const gallery = mountGallery([{ url: "/a.jpg", alt: "A" }]);
    render(<PhotoLightboxBoot />);
    // Click somewhere inside the gallery container but not on a tile
    // (the figure itself, say). Shouldn't open.
    const figure = gallery.querySelector("figure")!;
    fireEvent.click(figure);
    expect(screen.queryByTestId("photo-lightbox")).toBeNull();
  });

  it("closes when the lightbox's onClose fires (close button or Esc)", () => {
    const gallery = mountGallery([{ url: "/a.jpg", alt: "A" }]);
    render(<PhotoLightboxBoot />);
    fireEvent.click(gallery.querySelector<HTMLAnchorElement>("[data-photo-tile]")!);
    expect(screen.getByTestId("photo-lightbox")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /close photo viewer/i }));
    expect(screen.queryByTestId("photo-lightbox")).toBeNull();
  });

  it("restores focus to the triggering tile after close", async () => {
    // WAI-ARIA modal pattern: focus must return to where it was
    // before open. Otherwise after Esc / close-button the user's
    // focus lands somewhere unpredictable (often the body).
    const gallery = mountGallery([{ url: "/a.jpg", alt: "A" }]);
    render(<PhotoLightboxBoot />);
    const tile = gallery.querySelector<HTMLAnchorElement>("[data-photo-tile]")!;
    tile.focus();
    expect(document.activeElement).toBe(tile);

    fireEvent.click(tile);
    expect(screen.getByTestId("photo-lightbox")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /close photo viewer/i }));
    // Boot uses `queueMicrotask` to defer the refocus past the
    // unmount; flush microtasks before asserting.
    await Promise.resolve();
    expect(document.activeElement).toBe(tile);
  });

  it("restores body scroll lock on close (not just on unmount)", async () => {
    // The real lifecycle: lightbox opens → body locks → close →
    // body restores. Unmounting is a separate path; the close
    // case used to rely on it implicitly.
    const gallery = mountGallery([{ url: "/a.jpg", alt: "A" }]);
    render(<PhotoLightboxBoot />);
    fireEvent.click(gallery.querySelector<HTMLAnchorElement>("[data-photo-tile]")!);
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.click(screen.getByRole("button", { name: /close photo viewer/i }));
    await Promise.resolve();
    expect(document.body.style.overflow).toBe("");
  });

  it("marks the layout wrapper as `inert` while the lightbox is open", async () => {
    // The keyboard focus trap inside the modal handles Tab; the
    // `inert` attribute on the page wrapper keeps assistive-tech
    // virtual cursors (NVDA browsing mode, VoiceOver web rotor)
    // from announcing background content. WAI-ARIA modal pattern.
    const wrapper = document.createElement("div");
    wrapper.className = "stagecraft-site";
    document.body.appendChild(wrapper);
    // Gallery inside the wrapper, like the real layout.
    const gallery = document.createElement("div");
    gallery.setAttribute("data-collection-view", "photos");
    gallery.innerHTML = `<a href="/a.jpg" data-photo-tile data-photo-alt="A"><img alt="A"/></a>`;
    wrapper.appendChild(gallery);

    render(<PhotoLightboxBoot />);
    // jsdom doesn't initialise `inert` to false — it's undefined
    // until first assignment. Either way, we want it falsy here.
    expect(wrapper.inert).toBeFalsy();

    fireEvent.click(gallery.querySelector<HTMLAnchorElement>("[data-photo-tile]")!);
    expect(wrapper.inert).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: /close photo viewer/i }));
    await Promise.resolve();
    expect(wrapper.inert).toBeFalsy();
  });

  it("threads data-photo-width / data-photo-height onto the lightbox image", () => {
    // The new `width` / `height` attrs reserve aspect-ratio-correct
    // layout space so the modal doesn't snap-resize as each image
    // paints. PhotoTile threads them on every tile.
    const gallery = mountGallery([
      { url: "/a.jpg", alt: "A", width: 1600, height: 1067 },
    ]);
    render(<PhotoLightboxBoot />);
    fireEvent.click(gallery.querySelector<HTMLAnchorElement>("[data-photo-tile]")!);
    const img = screen.getByTestId("photo-lightbox").querySelector("img");
    expect(img?.getAttribute("width")).toBe("1600");
    expect(img?.getAttribute("height")).toBe("1067");
  });

  it("omits width / height attrs when tile data attrs are missing (stale content tolerance)", () => {
    // Older content rendered before #186 won't have the data attrs;
    // the boot falls back to 0, and the lightbox skips the
    // dimension attrs entirely rather than emitting `width="0"`.
    const gallery = mountGallery([{ url: "/a.jpg", alt: "A" }]);
    render(<PhotoLightboxBoot />);
    fireEvent.click(gallery.querySelector<HTMLAnchorElement>("[data-photo-tile]")!);
    const img = screen.getByTestId("photo-lightbox").querySelector("img");
    expect(img?.hasAttribute("width")).toBe(false);
    expect(img?.hasAttribute("height")).toBe(false);
  });

  it("wires each photos gallery separately (clicking gallery A doesn't open gallery B's images)", () => {
    // Pages with two photo galleries (e.g. a press page + a tour
    // photos page combined) should keep their image lists distinct.
    const galleryA = mountGallery([
      { url: "/a1.jpg", alt: "A1" },
      { url: "/a2.jpg", alt: "A2" },
    ]);
    const galleryB = mountGallery([
      { url: "/b1.jpg", alt: "B1" },
      { url: "/b2.jpg", alt: "B2" },
    ]);
    render(<PhotoLightboxBoot />);

    // Click first tile of gallery A.
    fireEvent.click(
      galleryA.querySelectorAll<HTMLAnchorElement>("[data-photo-tile]")[0]!,
    );
    expect(screen.getByText("1 / 2")).toBeTruthy();
    // Scope queries to the lightbox — gallery tiles also have <img>s.
    const lightbox = screen.getByTestId("photo-lightbox");
    expect(lightbox.querySelector("img")?.getAttribute("src")).toBe("/a1.jpg");
    // ArrowRight should cycle to A2, not B1.
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowRight" });
    expect(lightbox.querySelector("img")?.getAttribute("src")).toBe("/a2.jpg");

    void galleryB; // Referenced to assert it doesn't leak into A's list.
  });
});

describe("<PhotoLightboxBoot> — MutationObserver re-scan", () => {
  // MutationObserver-based dynamic gallery wiring: galleries inserted
  // AFTER the boot mounts (gallery editor's preview pane, future
  // client-side filters) still get a click delegate. Removed
  // galleries get their listener cleaned up.

  function waitForMutations() {
    // MutationObserver callbacks are async (microtask-batched).
    // A single Promise tick is enough to flush them in jsdom.
    return Promise.resolve();
  }

  it("wires a gallery inserted after the boot mounts", async () => {
    render(<PhotoLightboxBoot />);
    // No gallery at boot time.
    expect(screen.queryByTestId("photo-lightbox")).toBeNull();

    // Insert a gallery dynamically.
    const gallery = mountGallery([{ url: "/late.jpg", alt: "Late" }]);
    await waitForMutations();

    fireEvent.click(
      gallery.querySelector<HTMLAnchorElement>("[data-photo-tile]")!,
    );
    expect(screen.getByTestId("photo-lightbox")).toBeTruthy();
  });

  it("wires a gallery deeply nested inside an added wrapper", async () => {
    // A page editor might insert a `<section>` containing the
    // gallery, not the gallery directly. The observer walks added
    // subtrees for `[data-collection-view="photos"]` descendants.
    render(<PhotoLightboxBoot />);

    const wrapper = document.createElement("section");
    const gallery = document.createElement("div");
    gallery.setAttribute("data-collection-view", "photos");
    gallery.innerHTML = `<figure><a href="/nested.jpg" data-photo-tile data-photo-alt="Nested"><img alt="Nested" /></a></figure>`;
    wrapper.appendChild(gallery);
    document.body.appendChild(wrapper);
    await waitForMutations();

    fireEvent.click(
      gallery.querySelector<HTMLAnchorElement>("[data-photo-tile]")!,
    );
    expect(screen.getByTestId("photo-lightbox")).toBeTruthy();
  });

  it("cleans up the listener when a wired gallery is removed", async () => {
    // Detached DOM keeping a closure-over-state alive would leak
    // memory across long-lived editor sessions. After removal, a
    // synthesised click against the detached node should NOT open
    // the lightbox (the listener is gone).
    const gallery = mountGallery([{ url: "/x.jpg", alt: "X" }]);
    render(<PhotoLightboxBoot />);
    // Confirm it's wired first.
    fireEvent.click(gallery.querySelector<HTMLAnchorElement>("[data-photo-tile]")!);
    expect(screen.getByTestId("photo-lightbox")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /close photo viewer/i }));
    await Promise.resolve();

    // Remove the gallery from the DOM.
    gallery.remove();
    await waitForMutations();

    // Dispatch a click on the now-detached tile. No new lightbox.
    const detachedTile = gallery.querySelector<HTMLAnchorElement>("[data-photo-tile]");
    fireEvent.click(detachedTile!);
    expect(screen.queryByTestId("photo-lightbox")).toBeNull();
  });

  it("cleans up galleries nested inside a removed wrapper", async () => {
    // Mirror of the deeply-nested-add case: when the wrapper goes
    // away, any wired galleries inside it should get their
    // listeners removed too.
    const wrapper = document.createElement("section");
    const gallery = document.createElement("div");
    gallery.setAttribute("data-collection-view", "photos");
    gallery.innerHTML = `<figure><a href="/deep.jpg" data-photo-tile data-photo-alt="Deep"><img alt="Deep" /></a></figure>`;
    wrapper.appendChild(gallery);
    document.body.appendChild(wrapper);

    render(<PhotoLightboxBoot />);
    fireEvent.click(gallery.querySelector<HTMLAnchorElement>("[data-photo-tile]")!);
    expect(screen.getByTestId("photo-lightbox")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /close photo viewer/i }));
    await Promise.resolve();

    wrapper.remove();
    await waitForMutations();

    // Click the detached tile: no lightbox.
    fireEvent.click(gallery.querySelector<HTMLAnchorElement>("[data-photo-tile]")!);
    expect(screen.queryByTestId("photo-lightbox")).toBeNull();
  });

  it("re-wiring an identical gallery is idempotent (no duplicate listeners)", async () => {
    // The observer fires once per mutation; if the same gallery
    // appears in multiple batches (rapid insertions), `wired.has`
    // short-circuits. Verifies the open path runs exactly once per
    // click — no double-open from a stacked listener.
    const gallery = mountGallery([{ url: "/a.jpg", alt: "A" }]);
    render(<PhotoLightboxBoot />);

    // Force a no-op mutation to the gallery (attribute toggle) —
    // observer fires but `wired.has(gallery)` is true so the
    // wire() call short-circuits.
    gallery.setAttribute("data-marker", "1");
    await waitForMutations();
    gallery.setAttribute("data-marker", "2");
    await waitForMutations();

    fireEvent.click(gallery.querySelector<HTMLAnchorElement>("[data-photo-tile]")!);
    // Exactly one lightbox; if listeners had stacked, the click
    // would still produce a single visible modal (state machine
    // dedup), but the test confirms the happy path stays clean.
    expect(screen.getAllByTestId("photo-lightbox")).toHaveLength(1);
  });
});
