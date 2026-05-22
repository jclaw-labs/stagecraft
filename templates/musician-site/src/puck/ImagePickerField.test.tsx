/**
 * Interaction tests for ImagePickerField — the click-to-set focal
 * point picker, inline caption / credit / alt edits, and the
 * `onChange` contract for post-upload mutations. Runs in jsdom
 * because the focal-point picker depends on `getBoundingClientRect`
 * and click events.
 */
// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ImagePickerField } from "./ImagePickerField";
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

describe("<ImagePickerField> — empty state", () => {
  it("renders no preview / edit fields when value is null", () => {
    render(<ImagePickerField value={null} onChange={vi.fn()} />);
    expect(screen.queryByTestId("image-picker-preview")).toBeNull();
    expect(screen.queryByPlaceholderText(/Soundcheck/)).toBeNull();
  });
});
