// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { FontPickerField } from "./FontPickerField";

describe("<FontPickerField>", () => {
  it("derives the category from a curated family and selects it in the family list", () => {
    render(<FontPickerField id="bf" label="Body font" value="Inter" onChange={() => {}} />);
    expect((screen.getByLabelText("Body font — category") as HTMLSelectElement).value).toBe(
      "sans-serif",
    );
    expect((screen.getByLabelText("Body font — family") as HTMLSelectElement).value).toBe("Inter");
  });

  it("switching category snaps the family to the first of that category", () => {
    const onChange = vi.fn();
    render(<FontPickerField id="bf" label="Body font" value="Inter" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Body font — category"), {
      target: { value: "serif" },
    });
    expect(onChange).toHaveBeenCalledWith("Merriweather");
  });

  it("selecting a family reports it through onChange", () => {
    const onChange = vi.fn();
    render(<FontPickerField id="bf" label="Body font" value="Inter" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Body font — family"), {
      target: { value: "Poppins" },
    });
    expect(onChange).toHaveBeenCalledWith("Poppins");
  });

  it("treats an unknown family as Custom and shows a free-text input", () => {
    const onChange = vi.fn();
    render(
      <FontPickerField id="bf" label="Body font" value="My Bespoke Face" onChange={onChange} />,
    );
    expect((screen.getByLabelText("Body font — category") as HTMLSelectElement).value).toBe(
      "custom",
    );
    const input = screen.getByLabelText("Body font") as HTMLInputElement;
    expect(input.value).toBe("My Bespoke Face");
    fireEvent.change(input, { target: { value: "Another Face" } });
    expect(onChange).toHaveBeenCalledWith("Another Face");
  });
});
