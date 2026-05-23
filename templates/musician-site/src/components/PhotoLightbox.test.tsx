/**
 * Interaction tests for the photo lightbox modal. Uses jsdom +
 * testing-library because the lightbox is fundamentally
 * interactive (keyboard nav, focus management, click handlers).
 * SSR snapshot coverage is in PhotoLightboxBoot.test.tsx (the
 * boot exists solely to wire up click delegation).
 */
// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { PhotoLightbox, type LightboxImage } from "./PhotoLightbox";

const IMAGES: LightboxImage[] = [
  { url: "/images/uploads/a/1600.webp", alt: "First", caption: "Cap A", credit: "Photo by A", width: 1600, height: 1067 },
  { url: "/images/uploads/b/1600.webp", alt: "Second", caption: "", credit: "", width: 1600, height: 900 },
  { url: "/images/uploads/c/1600.webp", alt: "Third", caption: "Cap C", credit: "", width: 1200, height: 1600 },
];

afterEach(() => {
  cleanup();
  document.body.style.overflow = "";
});

describe("<PhotoLightbox> — initial render", () => {
  it("renders the image at the initial index", () => {
    render(<PhotoLightbox images={IMAGES} initialIndex={1} onClose={vi.fn()} />);
    const img = screen.getByRole("img");
    expect(img.getAttribute("src")).toBe("/images/uploads/b/1600.webp");
    expect(img.getAttribute("alt")).toBe("Second");
  });

  it("declares itself as a modal dialog with an accessible name", () => {
    render(<PhotoLightbox images={IMAGES} initialIndex={0} onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-label")).toBe("First");
  });

  it("moves focus to the close button on open (so keyboard handlers land)", () => {
    render(<PhotoLightbox images={IMAGES} initialIndex={0} onClose={vi.fn()} />);
    const closeBtn = screen.getByRole("button", { name: /close photo viewer/i });
    expect(document.activeElement).toBe(closeBtn);
  });

  it("locks background scroll while open (restored on close)", () => {
    const { unmount } = render(
      <PhotoLightbox images={IMAGES} initialIndex={0} onClose={vi.fn()} />,
    );
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).toBe("");
  });

  it("renders prev / next + counter when multiple images present", () => {
    render(<PhotoLightbox images={IMAGES} initialIndex={0} onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: /previous photo/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /next photo/i })).toBeTruthy();
    expect(screen.getByText("1 / 3")).toBeTruthy();
  });

  it("suppresses prev / next / counter for a single-image gallery", () => {
    render(
      <PhotoLightbox images={[IMAGES[0]!]} initialIndex={0} onClose={vi.fn()} />,
    );
    expect(screen.queryByRole("button", { name: /previous photo/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /next photo/i })).toBeNull();
    expect(screen.queryByText(/1 \//)).toBeNull();
  });

  it("renders caption + credit when present", () => {
    render(<PhotoLightbox images={IMAGES} initialIndex={0} onClose={vi.fn()} />);
    expect(screen.getByText("Cap A")).toBeTruthy();
    expect(screen.getByText(/Photo by A/)).toBeTruthy();
  });

  it("omits the figcaption entirely when both caption + credit are empty", () => {
    render(<PhotoLightbox images={IMAGES} initialIndex={1} onClose={vi.fn()} />);
    // The dialog has an <img> but no <figcaption>.
    expect(document.querySelector("figcaption")).toBeNull();
  });
});

describe("<PhotoLightbox> — keyboard navigation", () => {
  it("Esc closes via onClose", () => {
    const onClose = vi.fn();
    render(<PhotoLightbox images={IMAGES} initialIndex={0} onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("ArrowRight advances to the next image", () => {
    render(<PhotoLightbox images={IMAGES} initialIndex={0} onClose={vi.fn()} />);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowRight" });
    expect(screen.getByRole("img").getAttribute("src")).toBe(IMAGES[1]!.url);
  });

  it("ArrowLeft cycles backward and wraps around at start", () => {
    render(<PhotoLightbox images={IMAGES} initialIndex={0} onClose={vi.fn()} />);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowLeft" });
    // Wraps to the last image.
    expect(screen.getByRole("img").getAttribute("src")).toBe(IMAGES[2]!.url);
  });

  it("ArrowRight wraps to the start at the last image", () => {
    render(<PhotoLightbox images={IMAGES} initialIndex={2} onClose={vi.fn()} />);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowRight" });
    expect(screen.getByRole("img").getAttribute("src")).toBe(IMAGES[0]!.url);
  });

  it("arrow keys are no-ops on a single-image gallery", () => {
    render(
      <PhotoLightbox images={[IMAGES[0]!]} initialIndex={0} onClose={vi.fn()} />,
    );
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowRight" });
    expect(screen.getByRole("img").getAttribute("src")).toBe(IMAGES[0]!.url);
  });

  it("Home jumps to the first image", () => {
    render(<PhotoLightbox images={IMAGES} initialIndex={2} onClose={vi.fn()} />);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Home" });
    expect(screen.getByRole("img").getAttribute("src")).toBe(IMAGES[0]!.url);
    expect(screen.getByText("1 / 3")).toBeTruthy();
  });

  it("End jumps to the last image", () => {
    render(<PhotoLightbox images={IMAGES} initialIndex={0} onClose={vi.fn()} />);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "End" });
    expect(screen.getByRole("img").getAttribute("src")).toBe(IMAGES[2]!.url);
    expect(screen.getByText("3 / 3")).toBeTruthy();
  });

  it("Home / End are no-ops on a single-image gallery", () => {
    // No counter to assert against (suppressed for single-image);
    // just verify the image doesn't change.
    render(
      <PhotoLightbox images={[IMAGES[0]!]} initialIndex={0} onClose={vi.fn()} />,
    );
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "End" });
    expect(screen.getByRole("img").getAttribute("src")).toBe(IMAGES[0]!.url);
  });
});

describe("<PhotoLightbox> — image dimensions", () => {
  it("forwards width / height attrs from the image to the <img> for CLS-safe layout", () => {
    // The browser uses these to reserve aspect-ratio-correct
    // layout space before the image paints, so the figure doesn't
    // snap-resize as each image loads.
    render(<PhotoLightbox images={IMAGES} initialIndex={0} onClose={vi.fn()} />);
    const img = screen.getByRole("img");
    expect(img.getAttribute("width")).toBe("1600");
    expect(img.getAttribute("height")).toBe("1067");
  });

  it("omits width / height when either is 0 (older content without dimensions)", () => {
    // Tolerance for tiles that pre-date the data-photo-width /
    // data-photo-height threading. The lightbox still renders;
    // the browser just can't pre-reserve layout space.
    const without: LightboxImage = {
      ...IMAGES[0]!,
      width: 0,
      height: 0,
    };
    render(
      <PhotoLightbox images={[without]} initialIndex={0} onClose={vi.fn()} />,
    );
    const img = screen.getByRole("img");
    expect(img.hasAttribute("width")).toBe(false);
    expect(img.hasAttribute("height")).toBe(false);
  });
});

describe("<PhotoLightbox> — click handlers", () => {
  it("clicking the backdrop closes (but inner image / button click does not)", () => {
    const onClose = vi.fn();
    render(<PhotoLightbox images={IMAGES} initialIndex={0} onClose={onClose} />);
    const dialog = screen.getByRole("dialog");

    // Click directly on the dialog backdrop.
    fireEvent.click(dialog, { target: dialog, currentTarget: dialog });
    expect(onClose).toHaveBeenCalledOnce();

    // Click on the image should not close — the click target is the
    // `<img>`, not the dialog backdrop.
    onClose.mockClear();
    fireEvent.click(screen.getByRole("img"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("close button closes", () => {
    const onClose = vi.fn();
    render(<PhotoLightbox images={IMAGES} initialIndex={0} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /close photo viewer/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("prev / next buttons cycle the active image", () => {
    render(<PhotoLightbox images={IMAGES} initialIndex={0} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /next photo/i }));
    expect(screen.getByRole("img").getAttribute("src")).toBe(IMAGES[1]!.url);
    fireEvent.click(screen.getByRole("button", { name: /previous photo/i }));
    expect(screen.getByRole("img").getAttribute("src")).toBe(IMAGES[0]!.url);
  });
});

describe("<PhotoLightbox> — edge cases", () => {
  it("clamps an out-of-range initialIndex to 0", () => {
    render(<PhotoLightbox images={IMAGES} initialIndex={-5} onClose={vi.fn()} />);
    expect(screen.getByRole("img").getAttribute("src")).toBe(IMAGES[0]!.url);
  });

  it("clamps an oversized initialIndex to the last image", () => {
    render(<PhotoLightbox images={IMAGES} initialIndex={999} onClose={vi.fn()} />);
    expect(screen.getByRole("img").getAttribute("src")).toBe(IMAGES[2]!.url);
  });

  it("renders null for an empty images array (guards against stale event payloads)", () => {
    const { container } = render(
      <PhotoLightbox images={[]} initialIndex={0} onClose={vi.fn()} />,
    );
    // Component returns null when there's no current image to show.
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
});

describe("<PhotoLightbox> — touch swipe navigation", () => {
  // Standard mobile photo-viewer convention: swipe LEFT advances
  // (next image), swipe RIGHT goes back (previous image). The
  // existing prev/next + arrow-key handlers already cover the
  // semantics; these tests lock the touch → handler plumbing.

  function fireSwipe(
    target: Element,
    { dx, dy = 0 }: { dx: number; dy?: number },
  ): void {
    // Synthesise a touch from (100, 100) to (100+dx, 100+dy).
    fireEvent.touchStart(target, {
      touches: [{ clientX: 100, clientY: 100 }],
    });
    fireEvent.touchEnd(target, {
      changedTouches: [{ clientX: 100 + dx, clientY: 100 + dy }],
      touches: [],
    });
  }

  it("swipe LEFT advances to the next image", () => {
    render(<PhotoLightbox images={IMAGES} initialIndex={0} onClose={vi.fn()} />);
    fireSwipe(screen.getByRole("dialog"), { dx: -120 });
    expect(screen.getByRole("img").getAttribute("src")).toBe(IMAGES[1]!.url);
  });

  it("swipe RIGHT goes back to the previous image (with wrap)", () => {
    render(<PhotoLightbox images={IMAGES} initialIndex={0} onClose={vi.fn()} />);
    fireSwipe(screen.getByRole("dialog"), { dx: 120 });
    // Wraps to the last image.
    expect(screen.getByRole("img").getAttribute("src")).toBe(IMAGES[2]!.url);
  });

  it("ignores swipes below the threshold (a tap shouldn't cycle)", () => {
    // dx=20 is well under the 50px threshold — should look like a
    // tap, not a swipe.
    render(<PhotoLightbox images={IMAGES} initialIndex={0} onClose={vi.fn()} />);
    fireSwipe(screen.getByRole("dialog"), { dx: 20 });
    expect(screen.getByRole("img").getAttribute("src")).toBe(IMAGES[0]!.url);
  });

  it("ignores mostly-vertical swipes (so scroll-like gestures don't cycle)", () => {
    // |dx| = 60 > 50px threshold but |dy| = 120 dominates — this is
    // a near-vertical gesture, not a cycle attempt.
    render(<PhotoLightbox images={IMAGES} initialIndex={0} onClose={vi.fn()} />);
    fireSwipe(screen.getByRole("dialog"), { dx: 60, dy: 120 });
    expect(screen.getByRole("img").getAttribute("src")).toBe(IMAGES[0]!.url);
  });

  it("ignores multi-touch starts (reserved for future pinch-zoom)", () => {
    // Two-finger touchstart on the dialog should not arm the swipe
    // state. Even a subsequent touchend with a large dx should be a
    // no-op because the start ref was cleared.
    render(<PhotoLightbox images={IMAGES} initialIndex={0} onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog");
    fireEvent.touchStart(dialog, {
      touches: [
        { clientX: 100, clientY: 100 },
        { clientX: 200, clientY: 100 },
      ],
    });
    fireEvent.touchEnd(dialog, {
      changedTouches: [{ clientX: 0, clientY: 100 }],
      touches: [],
    });
    expect(screen.getByRole("img").getAttribute("src")).toBe(IMAGES[0]!.url);
  });

  it("touchcancel discards the start coords (no swipe on subsequent touchend)", () => {
    // Simulates a browser interrupt mid-gesture. The next touchend
    // should be ignored — only a fresh touchstart re-arms the state.
    render(<PhotoLightbox images={IMAGES} initialIndex={0} onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog");
    fireEvent.touchStart(dialog, {
      touches: [{ clientX: 100, clientY: 100 }],
    });
    fireEvent.touchCancel(dialog);
    fireEvent.touchEnd(dialog, {
      changedTouches: [{ clientX: 0, clientY: 100 }],
      touches: [],
    });
    expect(screen.getByRole("img").getAttribute("src")).toBe(IMAGES[0]!.url);
  });

  it("swipe LEFT at the last image wraps to the first", () => {
    render(<PhotoLightbox images={IMAGES} initialIndex={2} onClose={vi.fn()} />);
    fireSwipe(screen.getByRole("dialog"), { dx: -120 });
    expect(screen.getByRole("img").getAttribute("src")).toBe(IMAGES[0]!.url);
  });

  it("swipes are no-ops on a single-image gallery", () => {
    // next/prev guard on total <= 1; the swipe handler can call them
    // freely without re-checking. Verify the image doesn't change.
    render(
      <PhotoLightbox images={[IMAGES[0]!]} initialIndex={0} onClose={vi.fn()} />,
    );
    fireSwipe(screen.getByRole("dialog"), { dx: -120 });
    fireSwipe(screen.getByRole("dialog"), { dx: 120 });
    expect(screen.getByRole("img").getAttribute("src")).toBe(IMAGES[0]!.url);
  });

  it("does NOT close the modal when the synthesised backdrop click follows a swipe", () => {
    // Browsers synthesise a `click` after a `touchstart`+`touchend`
    // sequence even on a 120px swipe (the touch→click cancel
    // threshold is wider than our swipe threshold). Without
    // suppression, a swipe across the backdrop would cycle AND
    // close. The implementation stamps a swipe time and the
    // backdrop click handler skips when within the suppression
    // window — verified here by firing the swipe then the click
    // synchronously.
    const onClose = vi.fn();
    render(<PhotoLightbox images={IMAGES} initialIndex={0} onClose={onClose} />);
    const dialog = screen.getByRole("dialog");
    fireSwipe(dialog, { dx: -120 });
    // Simulate the synthesised click. Backdrop click means the
    // event.target equals event.currentTarget.
    fireEvent.click(dialog, { target: dialog, currentTarget: dialog });
    expect(onClose).not.toHaveBeenCalled();
    // The swipe itself should have advanced the photo.
    expect(screen.getByRole("img").getAttribute("src")).toBe(IMAGES[1]!.url);
  });

  it("still closes on a backdrop click that wasn't preceded by a swipe", () => {
    // The suppression must not be sticky — a plain backdrop tap
    // after the swipe window expires (or with no swipe at all)
    // still closes. Without a prior swipe, lastSwipeAtRef stays
    // at 0, and Date.now() - 0 is well outside the 500ms window.
    const onClose = vi.fn();
    render(<PhotoLightbox images={IMAGES} initialIndex={0} onClose={onClose} />);
    const dialog = screen.getByRole("dialog");
    fireEvent.click(dialog, { target: dialog, currentTarget: dialog });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("exactly 50px horizontal swipe does NOT cycle (strict-less-than threshold)", () => {
    // Locks the threshold boundary: the implementation uses
    // `Math.abs(dx) < 50`, so dx=50 is the first value that counts.
    // dx=49 is the last value that does NOT.
    render(<PhotoLightbox images={IMAGES} initialIndex={0} onClose={vi.fn()} />);
    fireSwipe(screen.getByRole("dialog"), { dx: -49 });
    expect(screen.getByRole("img").getAttribute("src")).toBe(IMAGES[0]!.url);
  });

  it("exactly 50px horizontal swipe DOES cycle (strict-less-than threshold)", () => {
    render(<PhotoLightbox images={IMAGES} initialIndex={0} onClose={vi.fn()} />);
    fireSwipe(screen.getByRole("dialog"), { dx: -50 });
    expect(screen.getByRole("img").getAttribute("src")).toBe(IMAGES[1]!.url);
  });
});

describe("<PhotoLightbox> — pinch zoom", () => {
  // Two-finger pinch scales the image; one-finger gestures then pan
  // instead of navigating. jsdom reports offsetWidth=0 so pan
  // translation clamps to 0 here — the pan math is unit-tested in
  // lightbox-zoom.test.ts; these cover the gesture → transform wiring.

  type Pt = { clientX: number; clientY: number };

  function pinch(target: Element, start: [Pt, Pt], move: [Pt, Pt]): void {
    fireEvent.touchStart(target, { touches: start });
    fireEvent.touchMove(target, { touches: move });
  }

  function scaleFromTransform(img: Element): number {
    const t = (img as HTMLElement).style.transform;
    const m = t.match(/scale\(([\d.]+)\)/);
    return m ? Number(m[1]) : 1;
  }

  it("starts un-zoomed (scale 1, no translation)", () => {
    render(<PhotoLightbox images={IMAGES} initialIndex={0} onClose={vi.fn()} />);
    expect(scaleFromTransform(screen.getByRole("img"))).toBe(1);
  });

  it("scales the image up when the pinch span widens", () => {
    render(<PhotoLightbox images={IMAGES} initialIndex={0} onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog");
    // Span 100 → 200 = 2× from start scale 1.
    pinch(
      dialog,
      [{ clientX: 100, clientY: 100 }, { clientX: 200, clientY: 100 }],
      [{ clientX: 50, clientY: 100 }, { clientX: 250, clientY: 100 }],
    );
    expect(scaleFromTransform(screen.getByRole("img"))).toBe(2);
  });

  it("clamps the scale to the max zoom", () => {
    render(<PhotoLightbox images={IMAGES} initialIndex={0} onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog");
    // Span 50 → 1000 = 20× — clamps to MAX_ZOOM (4).
    pinch(
      dialog,
      [{ clientX: 100, clientY: 100 }, { clientX: 150, clientY: 100 }],
      [{ clientX: 0, clientY: 100 }, { clientX: 1000, clientY: 100 }],
    );
    expect(scaleFromTransform(screen.getByRole("img"))).toBe(4);
  });

  it("does not navigate on a one-finger swipe while zoomed (it pans instead)", () => {
    render(<PhotoLightbox images={IMAGES} initialIndex={0} onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog");
    pinch(
      dialog,
      [{ clientX: 100, clientY: 100 }, { clientX: 200, clientY: 100 }],
      [{ clientX: 50, clientY: 100 }, { clientX: 250, clientY: 100 }],
    );
    // End the pinch (both fingers up), leaving zoom in place.
    fireEvent.touchEnd(dialog, { touches: [], changedTouches: [] });
    expect(scaleFromTransform(screen.getByRole("img"))).toBe(2);

    // A horizontal one-finger swipe should now pan, NOT cycle.
    fireEvent.touchStart(dialog, { touches: [{ clientX: 100, clientY: 100 }] });
    fireEvent.touchEnd(dialog, {
      touches: [],
      changedTouches: [{ clientX: 250, clientY: 100 }],
    });
    expect(screen.getByRole("img").getAttribute("src")).toBe(IMAGES[0]!.url);
  });

  it("resets zoom when navigating to another image (via the next button)", () => {
    render(<PhotoLightbox images={IMAGES} initialIndex={0} onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog");
    pinch(
      dialog,
      [{ clientX: 100, clientY: 100 }, { clientX: 200, clientY: 100 }],
      [{ clientX: 50, clientY: 100 }, { clientX: 250, clientY: 100 }],
    );
    expect(scaleFromTransform(screen.getByRole("img"))).toBe(2);
    // Nav buttons work regardless of zoom; navigating resets it.
    fireEvent.click(screen.getByRole("button", { name: /next photo/i }));
    expect(screen.getByRole("img").getAttribute("src")).toBe(IMAGES[1]!.url);
    expect(scaleFromTransform(screen.getByRole("img"))).toBe(1);
  });

  it("snaps back to un-zoomed when a pinch settles at or below 1x", () => {
    render(<PhotoLightbox images={IMAGES} initialIndex={0} onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog");
    // Pinch inward (span shrinks) → scale clamps to 1.
    pinch(
      dialog,
      [{ clientX: 0, clientY: 100 }, { clientX: 400, clientY: 100 }],
      [{ clientX: 150, clientY: 100 }, { clientX: 250, clientY: 100 }],
    );
    fireEvent.touchEnd(dialog, { touches: [], changedTouches: [] });
    expect(scaleFromTransform(screen.getByRole("img"))).toBe(1);
    // Un-zoomed again → a one-finger swipe navigates.
    fireSwipeOnDialog(dialog, -120);
    expect(screen.getByRole("img").getAttribute("src")).toBe(IMAGES[1]!.url);
  });
});

// Shared helper for the snap-back test (mirrors the swipe describe's
// local helper without coupling the two blocks).
function fireSwipeOnDialog(dialog: Element, dx: number): void {
  fireEvent.touchStart(dialog, { touches: [{ clientX: 100, clientY: 100 }] });
  fireEvent.touchEnd(dialog, {
    touches: [],
    changedTouches: [{ clientX: 100 + dx, clientY: 100 }],
  });
}

describe("<PhotoLightbox> — focus trap (Tab cycling)", () => {
  it("Tab from the last focusable wraps back to the first", () => {
    render(<PhotoLightbox images={IMAGES} initialIndex={0} onClose={vi.fn()} />);
    const closeBtn = screen.getByRole("button", { name: /close photo viewer/i });
    const prev = screen.getByRole("button", { name: /previous photo/i });
    const next = screen.getByRole("button", { name: /next photo/i });

    // Tab order in the DOM: close → prev → next. Move focus to the
    // last and press Tab — it should wrap to the first.
    next.focus();
    expect(document.activeElement).toBe(next);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Tab" });
    expect(document.activeElement).toBe(closeBtn);
    // prev wasn't asserted; the assertion is about wrap-to-first.
    void prev;
  });

  it("Shift+Tab from the first focusable wraps back to the last", () => {
    render(<PhotoLightbox images={IMAGES} initialIndex={0} onClose={vi.fn()} />);
    const closeBtn = screen.getByRole("button", { name: /close photo viewer/i });
    const next = screen.getByRole("button", { name: /next photo/i });

    closeBtn.focus();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(next);
  });
});
