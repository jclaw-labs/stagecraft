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

  it("switching category updates the category select and snaps the family to the first of it", () => {
    const onChange = vi.fn();
    render(<FontPickerField id="bf" label="Body font" value="Inter" onChange={onChange} />);
    const category = screen.getByLabelText("Body font — category") as HTMLSelectElement;
    fireEvent.change(category, { target: { value: "serif" } });
    // Category state actually moved (not just the onChange snap).
    expect(category.value).toBe("serif");
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

  it("allowInherit: a blank value opens on the inherit choice", () => {
    render(
      <FontPickerField
        id="hf"
        label="Heading font"
        value=""
        onChange={() => {}}
        allowInherit
        inheritLabel="Same as body"
      />,
    );
    expect((screen.getByLabelText("Heading font — category") as HTMLSelectElement).value).toBe(
      "__inherit__",
    );
    // No family select / custom input is shown in the inherit state.
    expect(screen.queryByLabelText("Heading font — family")).toBeNull();
  });

  it("allowInherit: choosing inherit clears the family, choosing a category sets one", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <FontPickerField
        id="hf"
        label="Heading font"
        value="Lora"
        onChange={onChange}
        allowInherit
        inheritLabel="Same as body"
      />,
    );
    const category = screen.getByLabelText("Heading font — category") as HTMLSelectElement;
    expect(category.value).toBe("serif"); // Lora is a curated serif
    fireEvent.change(category, { target: { value: "__inherit__" } });
    expect(onChange).toHaveBeenCalledWith("");

    onChange.mockClear();
    rerender(
      <FontPickerField
        id="hf"
        label="Heading font"
        value=""
        onChange={onChange}
        allowInherit
        inheritLabel="Same as body"
      />,
    );
    fireEvent.change(screen.getByLabelText("Heading font — category"), {
      target: { value: "sans-serif" },
    });
    expect(onChange).toHaveBeenCalledWith("Inter");
  });
});
