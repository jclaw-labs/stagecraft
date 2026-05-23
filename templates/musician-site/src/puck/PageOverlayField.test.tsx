/**
 * Interaction tests for the per-page background-overlay custom field.
 * The point of this field is to make the null (inherit) vs 0..1
 * (explicit override) distinction unambiguous — a bare number input
 * can't, because a cleared value serialises as 0. Runs in jsdom for
 * the radio + slider interactions.
 */
// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { PageOverlayField } from "./PageOverlayField";

afterEach(cleanup);

describe("<PageOverlayField> — inherit vs custom state", () => {
  it("selects Inherit and hides the slider when value is null", () => {
    render(<PageOverlayField value={null} onChange={vi.fn()} />);
    const inherit = screen.getByLabelText(/inherit site default/i) as HTMLInputElement;
    expect(inherit.checked).toBe(true);
    expect(screen.queryByTestId("page-overlay-slider")).toBeNull();
  });

  it("selects Custom and shows the slider when value is a number", () => {
    render(<PageOverlayField value={0.3} onChange={vi.fn()} />);
    const custom = screen.getByLabelText(/custom tint/i) as HTMLInputElement;
    expect(custom.checked).toBe(true);
    const slider = screen.getByTestId("page-overlay-slider") as HTMLInputElement;
    expect(slider.value).toBe("0.3");
    expect(screen.getByTestId("page-overlay-readout").textContent).toBe("0.30");
  });

  it("treats 0 as an explicit Custom override (not inherit)", () => {
    // The whole reason this field exists: 0 must read as "Custom, no
    // tint" — distinct from null (inherit). A number field would
    // blur the two.
    render(<PageOverlayField value={0} onChange={vi.fn()} />);
    expect((screen.getByLabelText(/custom tint/i) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText(/inherit/i) as HTMLInputElement).checked).toBe(false);
    expect(screen.getByTestId("page-overlay-slider")).not.toBeNull();
  });
});

describe("<PageOverlayField> — onChange contract", () => {
  it("emits null when switching to Inherit", () => {
    const onChange = vi.fn();
    render(<PageOverlayField value={0.4} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText(/inherit site default/i));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("emits a number (the default 0) when switching from Inherit to Custom", () => {
    // Switching to Custom must produce a concrete number on disk, not
    // leave it null — otherwise the radio would say Custom but the
    // value would still inherit. The Custom radio only fires from the
    // Inherit state (it's already checked once the value is a number),
    // so the seed is always the default.
    const onChange = vi.fn();
    render(<PageOverlayField value={null} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText(/custom tint/i));
    expect(onChange).toHaveBeenLastCalledWith(0);
  });

  it("emits the slider value (clamped 0..1) on drag", () => {
    const onChange = vi.fn();
    render(<PageOverlayField value={0.3} onChange={onChange} />);
    fireEvent.change(screen.getByTestId("page-overlay-slider"), {
      target: { value: "0.75" },
    });
    expect(onChange).toHaveBeenLastCalledWith(0.75);
  });
});

describe("<PageOverlayField> — defensive value handling", () => {
  it("clamps an out-of-range incoming value into the slider", () => {
    render(<PageOverlayField value={1.5} onChange={vi.fn()} />);
    // Custom mode (it's a number), slider clamps to max 1.
    const slider = screen.getByTestId("page-overlay-slider") as HTMLInputElement;
    expect(slider.value).toBe("1");
  });

  it("treats undefined like null (inherit)", () => {
    render(
      <PageOverlayField
        value={undefined as unknown as number | null}
        onChange={vi.fn()}
      />,
    );
    expect((screen.getByLabelText(/inherit/i) as HTMLInputElement).checked).toBe(true);
  });
});

describe("<PageOverlayField> — accessibility + instance isolation", () => {
  it("associates the numeric readout with the slider via aria-describedby", () => {
    render(<PageOverlayField value={0.3} onChange={vi.fn()} />);
    const slider = screen.getByTestId("page-overlay-slider");
    const readout = screen.getByTestId("page-overlay-readout");
    expect(slider.getAttribute("aria-describedby")).toBe(readout.id);
    expect(readout.id).toBeTruthy();
  });

  it("gives each instance a unique radio group name (no cross-instance coupling)", () => {
    // Radio groups are document-global by name; two instances sharing
    // a hardcoded name would merge into one group. useId keeps them
    // independent.
    const { container: a } = render(<PageOverlayField value={null} onChange={vi.fn()} />);
    const { container: b } = render(<PageOverlayField value={null} onChange={vi.fn()} />);
    const nameA = a.querySelector('input[type="radio"]')?.getAttribute("name");
    const nameB = b.querySelector('input[type="radio"]')?.getAttribute("name");
    expect(nameA).toBeTruthy();
    expect(nameB).toBeTruthy();
    expect(nameA).not.toBe(nameB);
  });
});
