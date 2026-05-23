/**
 * Interaction tests for ImagePickerField — the click-to-set focal
 * point picker, inline caption / credit / alt edits, and the
 * `onChange` contract for post-upload mutations. Runs in jsdom
 * because the focal-point picker depends on `getBoundingClientRect`
 * and click events.
 */
// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { uploadImageFromClientMock } = vi.hoisted(() => ({
  uploadImageFromClientMock: vi.fn(),
}));
vi.mock("@/lib/upload-image-client", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/upload-image-client")>(
      "@/lib/upload-image-client",
    );
  return { ...actual, uploadImageFromClient: uploadImageFromClientMock };
});

import { ImagePickerField, SanitisedHint } from "./ImagePickerField";
import { asImageId, type ImageMetadata } from "@/lib/image-types";

const VALUE: ImageMetadata = {
  id: asImageId("abc1234567890def"),
  alt: "A photo",
  width: 1600,
  height: 1067,
  placeholderDataUri: "data:image/webp;base64,UklGRhYAAABXRUJQVlA4TAo=",
  contentSlug: "home",
  originalExt: "jpg",
};

/**
 * `<img>` has no layout in jsdom, so `getBoundingClientRect` returns
 * a zero-sized rect by default. Stub it to a known 200×100 box so
 * the picker can map click coordinates onto 0..1 focal-point space.
 */
function stubImageRect(width = 200, height = 100): void {
  Object.defineProperty(HTMLImageElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value(): DOMRect {
      return {
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: width,
        bottom: height,
        width,
        height,
        toJSON: () => ({}),
      } as DOMRect;
    },
  });
}

describe("<ImagePickerField> — post-upload edits", () => {
  // Inputs are controlled (the value flows in via the prop); the
  // parent in production updates the prop after onChange, but our
  // mock doesn't, so we drive the inputs with `fireEvent.change`
  // (one synthetic change event per assertion) rather than
  // `userEvent.type` (which key-by-key types into the still-
  // unchanged controlled value).

  it("calls onChange with the updated alt when the alt input is edited", () => {
    const onChange = vi.fn();
    render(<ImagePickerField value={VALUE} onChange={onChange} />);
    const altInput = screen.getByDisplayValue("A photo");
    fireEvent.change(altInput, { target: { value: "New alt" } });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ alt: "New alt" }),
    );
  });

  it("threads caption / credit through onChange", () => {
    const onChange = vi.fn();
    render(<ImagePickerField value={VALUE} onChange={onChange} />);

    const captionInput = screen.getByPlaceholderText(/Soundcheck/);
    fireEvent.change(captionInput, { target: { value: "Soundcheck note" } });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ caption: "Soundcheck note" }),
    );

    const creditInput = screen.getByPlaceholderText(/Photo by/);
    fireEvent.change(creditInput, { target: { value: "Photo by Jane" } });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ credit: "Photo by Jane" }),
    );
  });

  it("strips caption / credit from the persisted shape when cleared to empty", () => {
    // The on-disk JSON shouldn't carry `"caption": ""` once an artist
    // clears the field — re-opening the editor should look like
    // "caption was never set" rather than "caption was cleared."
    const withCaption: ImageMetadata = { ...VALUE, caption: "old" };
    const onChange = vi.fn();
    render(<ImagePickerField value={withCaption} onChange={onChange} />);
    const captionInput = screen.getByDisplayValue("old");
    fireEvent.change(captionInput, { target: { value: "" } });
    const last = onChange.mock.calls.at(-1)?.[0] as ImageMetadata;
    expect(last).not.toHaveProperty("caption");
  });
});

describe("<ImagePickerField> — focal point picker", () => {
  it("renders no focal-point marker by default (no focalPoint set)", () => {
    render(<ImagePickerField value={VALUE} onChange={vi.fn()} />);
    expect(screen.queryByTestId("image-picker-focal-marker")).toBeNull();
  });

  it("renders the marker positioned at the focal-point coordinate", () => {
    const withFocal: ImageMetadata = {
      ...VALUE,
      focalPoint: { x: 0.3, y: 0.7 },
    };
    render(<ImagePickerField value={withFocal} onChange={vi.fn()} />);
    const marker = screen.getByTestId("image-picker-focal-marker");
    expect(marker.style.left).toBe("30%");
    expect(marker.style.top).toBe("70%");
  });

  it("sets focal point from a click on the preview image", async () => {
    stubImageRect(200, 100);
    const onChange = vi.fn();
    render(<ImagePickerField value={VALUE} onChange={onChange} />);
    const preview = screen.getByTestId("image-picker-preview");
    // Click at (50, 75) within the 200×100 rect → (0.25, 0.75).
    await userEvent.pointer({
      target: preview,
      keys: "[MouseLeft]",
      coords: { clientX: 50, clientY: 75 },
    });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ focalPoint: { x: 0.25, y: 0.75 } }),
    );
  });

  it("clamps clicks outside the rect to the 0..1 range", async () => {
    // Browsers can deliver clientX/Y just outside the rect on
    // sub-pixel rounding. We clamp so the persisted value always
    // stays in the schema's range.
    stubImageRect(200, 100);
    const onChange = vi.fn();
    render(<ImagePickerField value={VALUE} onChange={onChange} />);
    const preview = screen.getByTestId("image-picker-preview");
    await userEvent.pointer({
      target: preview,
      keys: "[MouseLeft]",
      coords: { clientX: -10, clientY: 200 },
    });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ focalPoint: { x: 0, y: 1 } }),
    );
  });

  it("clearing the focal point via Reset removes the key from the value", async () => {
    const withFocal: ImageMetadata = {
      ...VALUE,
      focalPoint: { x: 0.3, y: 0.7 },
    };
    const onChange = vi.fn();
    render(<ImagePickerField value={withFocal} onChange={onChange} />);
    const reset = screen.getByRole("button", { name: /Reset to center/ });
    await userEvent.click(reset);
    const last = onChange.mock.calls.at(-1)?.[0] as ImageMetadata;
    expect(last).not.toHaveProperty("focalPoint");
  });

  it("does not render the Reset button until a focal point is set", () => {
    render(<ImagePickerField value={VALUE} onChange={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /Reset to center/ })).toBeNull();
  });
});

describe("<ImagePickerField> — focal point keyboard control", () => {
  // Keyboard-only artists need an alternative to the click picker.
  // Arrow keys nudge the focal point in 5% steps (1% with shift);
  // Enter / Space recenters. The preview image carries role=button +
  // tabIndex=0 so a screen reader announces it as an interactive
  // control rather than decoration.

  it("renders the preview as a focusable button with descriptive aria-label", () => {
    render(<ImagePickerField value={VALUE} onChange={vi.fn()} />);
    const preview = screen.getByTestId("image-picker-preview");
    expect(preview.getAttribute("role")).toBe("button");
    expect(preview.getAttribute("tabIndex")).toBe("0");
    expect(preview.getAttribute("aria-label")).toMatch(/focal point/i);
  });

  it("ArrowRight nudges focal x by +5% from default centre", () => {
    const onChange = vi.fn();
    render(<ImagePickerField value={VALUE} onChange={onChange} />);
    const preview = screen.getByTestId("image-picker-preview");
    fireEvent.keyDown(preview, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ focalPoint: { x: 0.55, y: 0.5 } }),
    );
  });

  it("shift + arrow nudges by 1% (finer step)", () => {
    const onChange = vi.fn();
    render(<ImagePickerField value={VALUE} onChange={onChange} />);
    const preview = screen.getByTestId("image-picker-preview");
    fireEvent.keyDown(preview, { key: "ArrowUp", shiftKey: true });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ focalPoint: { x: 0.5, y: 0.49 } }),
    );
  });

  it("clamps keyboard nudges at the 0..1 boundary", () => {
    const withFocal: ImageMetadata = {
      ...VALUE,
      focalPoint: { x: 0.02, y: 0.5 },
    };
    const onChange = vi.fn();
    render(<ImagePickerField value={withFocal} onChange={onChange} />);
    const preview = screen.getByTestId("image-picker-preview");
    // 0.02 - 0.05 = -0.03, clamps to 0.
    fireEvent.keyDown(preview, { key: "ArrowLeft" });
    const last = onChange.mock.calls.at(-1)?.[0] as ImageMetadata;
    expect(last.focalPoint?.x).toBe(0);
  });

  it("Enter recenters (removes the focalPoint key)", () => {
    const withFocal: ImageMetadata = {
      ...VALUE,
      focalPoint: { x: 0.3, y: 0.7 },
    };
    const onChange = vi.fn();
    render(<ImagePickerField value={withFocal} onChange={onChange} />);
    const preview = screen.getByTestId("image-picker-preview");
    fireEvent.keyDown(preview, { key: "Enter" });
    const last = onChange.mock.calls.at(-1)?.[0] as ImageMetadata;
    expect(last).not.toHaveProperty("focalPoint");
  });
});

describe("<ImagePickerField> — preview path for vector uploads", () => {
  it("uses the original SVG path for SVG previews (no .webp variant exists)", () => {
    const svg: ImageMetadata = { ...VALUE, originalExt: "svg" };
    render(<ImagePickerField value={svg} onChange={vi.fn()} />);
    const preview = screen.getByTestId("image-picker-preview") as HTMLImageElement;
    expect(preview.getAttribute("src")).toBe(
      `/images/${svg.contentSlug}/${svg.id}/original.svg`,
    );
  });

  it("uses the original ICO path for ICO previews", () => {
    const ico: ImageMetadata = { ...VALUE, originalExt: "ico" };
    render(<ImagePickerField value={ico} onChange={vi.fn()} />);
    const preview = screen.getByTestId("image-picker-preview") as HTMLImageElement;
    expect(preview.getAttribute("src")).toBe(
      `/images/${ico.contentSlug}/${ico.id}/original.ico`,
    );
  });

  it("still uses a .webp variant for raster uploads", () => {
    render(<ImagePickerField value={VALUE} onChange={vi.fn()} />);
    const preview = screen.getByTestId("image-picker-preview") as HTMLImageElement;
    expect(preview.getAttribute("src")).toMatch(/\d+\.webp$/);
  });
});

describe("<ImagePickerField> — empty state", () => {
  it("renders no preview / edit fields when value is null", () => {
    render(<ImagePickerField value={null} onChange={vi.fn()} />);
    expect(screen.queryByTestId("image-picker-preview")).toBeNull();
    expect(screen.queryByPlaceholderText(/Soundcheck/)).toBeNull();
  });
});

describe("<ImagePickerField> — sanitised banner scoping", () => {
  // Coverage for the live banner-state plumbing inside ImagePickerField:
  // the report's image-id pairing protects against showing a stale
  // banner if the parent swaps `value` (Puck undo / history) without
  // firing handleClear.

  function svgUpload(removedTotal: number) {
    return {
      image: {
        ...VALUE,
        id: asImageId("svg11112222333344"),
        originalExt: "svg" as const,
      },
      sanitised: {
        removed: ["<script>"],
        removedTotal,
      },
    };
  }

  function pickFile(file: File): void {
    const fileInput = document.querySelector("input[type=file]") as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [file] } });
  }

  it("hides the banner when the parent swaps `value` to a different image id", async () => {
    // Artist uploads a dirty SVG → banner appears tied to that image's
    // id. Parent then restores a previous version (Puck undo), swapping
    // `value` to a different image without firing handleClear. The
    // stored banner state is still set, but the render guard sees
    // `lastSanitised.imageId !== value.id` and hides the banner.
    uploadImageFromClientMock.mockReset().mockResolvedValueOnce(svgUpload(3));

    let currentValue: ImageMetadata | null = null;
    const onChange = vi.fn((next: ImageMetadata | null) => {
      currentValue = next;
    });

    const { rerender } = render(
      <ImagePickerField value={currentValue} onChange={onChange} />,
    );

    // Drive the upload flow: pick a file → click Upload.
    pickFile(new File(["<svg/>"], "evil.svg", { type: "image/svg+xml" }));
    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: /Upload image/i }));
    });

    // The mock resolved with the new image; rerender with it as the
    // current value (mimics the parent reacting to onChange).
    rerender(<ImagePickerField value={currentValue} onChange={onChange} />);
    expect(screen.getByTestId("image-picker-sanitised-hint")).not.toBeNull();

    // Parent restores an unrelated image (different id) without
    // firing handleClear — the stale banner should disappear.
    const otherImage: ImageMetadata = {
      ...VALUE,
      id: asImageId("differentid12345"),
    };
    rerender(<ImagePickerField value={otherImage} onChange={onChange} />);
    expect(screen.queryByTestId("image-picker-sanitised-hint")).toBeNull();
  });

  it("does not show the banner when the server reports removedTotal=0 (clean SVG)", async () => {
    // A clean SVG upload with a defensive `sanitised: { removed: [],
    // removedTotal: 0 }` payload — the schema permits this, but the
    // UI should still treat it as "no banner."
    uploadImageFromClientMock.mockReset().mockResolvedValueOnce({
      image: { ...VALUE, id: asImageId("clean11112222aaaa"), originalExt: "svg" as const },
      sanitised: { removed: [], removedTotal: 0 },
    });

    let currentValue: ImageMetadata | null = null;
    const onChange = vi.fn((next: ImageMetadata | null) => {
      currentValue = next;
    });
    const { rerender } = render(
      <ImagePickerField value={currentValue} onChange={onChange} />,
    );
    pickFile(new File(["<svg/>"], "clean.svg", { type: "image/svg+xml" }));
    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: /Upload image/i }));
    });
    rerender(<ImagePickerField value={currentValue} onChange={onChange} />);
    expect(screen.queryByTestId("image-picker-sanitised-hint")).toBeNull();
  });
});

describe("<SanitisedHint>", () => {
  // The hint surfaces what the SVG sanitiser stripped from an upload.
  // Coverage focuses on the rendering contract — singular vs plural
  // language, the inline preview cap, and the "+ N more" tail — since
  // the picker's plumbing (setLastSanitised → render → clear on
  // Remove) is exercised by the live editor flow.

  it("shows the singular phrasing when exactly one item was removed", () => {
    render(
      <SanitisedHint sanitised={{ removed: ["<script>"], removedTotal: 1 }} />,
    );
    const hint = screen.getByTestId("image-picker-sanitised-hint");
    expect(hint.textContent).toMatch(/1 item was removed/);
    expect(hint.textContent).toContain("<script>");
  });

  it("shows the plural phrasing when more than one item was removed", () => {
    render(
      <SanitisedHint
        sanitised={{
          removed: ["<script>", "onclick=", "<foreignObject>"],
          removedTotal: 3,
        }}
      />,
    );
    const hint = screen.getByTestId("image-picker-sanitised-hint");
    expect(hint.textContent).toMatch(/3 items were removed/);
  });

  it("lists every removed item inline when under the preview cap", () => {
    // 5 items is right at the inline cap — every one appears in the
    // visible preview, no "+ N more" tail.
    render(
      <SanitisedHint
        sanitised={{
          removed: ["<script>", "<iframe>", "onclick=", "onload=", "<foreignObject>"],
          removedTotal: 5,
        }}
      />,
    );
    const hint = screen.getByTestId("image-picker-sanitised-hint");
    for (const removed of [
      "<script>",
      "<iframe>",
      "onclick=",
      "onload=",
      "<foreignObject>",
    ]) {
      expect(hint.textContent).toContain(removed);
    }
    expect(hint.textContent).not.toMatch(/more/);
  });

  it("collapses the tail into '+ N more' when the removed list exceeds the inline cap", () => {
    // 8 items > 5-item cap → first 5 shown, remaining 3 as "and 3 more".
    render(
      <SanitisedHint
        sanitised={{
          removed: [
            "<script>",
            "<iframe>",
            "onclick=",
            "onload=",
            "<foreignObject>",
            "onmouseover=",
            "onfocus=",
            "<animate>",
          ],
          removedTotal: 8,
        }}
      />,
    );
    const hint = screen.getByTestId("image-picker-sanitised-hint");
    expect(hint.textContent).toMatch(/and 3 more/);
    // The first five appear inline; the last three appear in the count
    // but not by name.
    expect(hint.textContent).toContain("<foreignObject>");
    expect(hint.textContent).not.toContain("onmouseover=");
  });

  it("uses `removedTotal` for the count (not the descriptor list length)", () => {
    // The server caps the descriptor list at 20 but tracks the true
    // count separately. For a pathological SVG with 50 stripped items,
    // the banner should say "50 items removed" — matching the server
    // log — not "20" (the visible sample size). Otherwise support
    // gets reports of "the log said 50 but my screen said 20."
    render(
      <SanitisedHint
        sanitised={{
          removed: Array.from({ length: 20 }, (_, i) => `<bad${i}>`),
          removedTotal: 50,
        }}
      />,
    );
    const hint = screen.getByTestId("image-picker-sanitised-hint");
    expect(hint.textContent).toMatch(/50 items were removed/);
    // The "+N more" tail accounts for the gap between visible preview
    // (5) and total (50).
    expect(hint.textContent).toMatch(/and 45 more/);
  });

  it("renders gracefully when removed[] is empty but removedTotal > 0 (defensive)", () => {
    // Schema permits this contract drift; the UI shouldn't render
    // a stray ": " with nothing after it.
    render(
      <SanitisedHint sanitised={{ removed: [], removedTotal: 7 }} />,
    );
    const hint = screen.getByTestId("image-picker-sanitised-hint");
    expect(hint.textContent).toMatch(/7 items were removed for your security\./);
    expect(hint.textContent).not.toMatch(/: \./);
  });

  it("uses role=status so the hint is announced to assistive tech", () => {
    // The artist hits Upload and the banner appears below — without
    // role=status, screen-reader users wouldn't notice the sanitiser
    // changed anything.
    render(
      <SanitisedHint sanitised={{ removed: ["<script>"], removedTotal: 1 }} />,
    );
    // `getByRole` throws if missing — implicit assertion.
    expect(screen.getByRole("status")).not.toBeNull();
  });
});
