import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import {
  CheckboxField,
  ColorField,
  Field,
  FieldGroup,
  NumberField,
  SelectField,
  TextField,
} from "./form";

/**
 * These tests render the form primitives through SSR (`renderToStaticMarkup`)
 * and assert on the resulting markup. Browser-side interaction is left to
 * the manual smoke tests — the value of SSR-checked snippets is making sure
 * the labels, aria attributes, and structural styling stay stable.
 */

describe("<TextField>", () => {
  it("renders a label associated with the input via htmlFor/id", () => {
    const html = renderToStaticMarkup(
      <TextField id="x" label="Artist name" value="" onChange={vi.fn()} />,
    );
    expect(html).toMatch(/<label[^>]*for="x"/);
    expect(html).toMatch(/<input[^>]*id="x"/);
  });

  it("renders a textarea when isMultiline=true", () => {
    const html = renderToStaticMarkup(
      <TextField label="Bio" value="" onChange={vi.fn()} isMultiline />,
    );
    expect(html).toContain("<textarea");
    expect(html).not.toMatch(/<input[^>]*type="text"/);
  });

  it("passes through the value and placeholder", () => {
    const html = renderToStaticMarkup(
      <TextField label="x" value="hello" onChange={vi.fn()} placeholder="type here" />,
    );
    expect(html).toContain('value="hello"');
    expect(html).toContain('placeholder="type here"');
  });

  it("renders the description text when supplied", () => {
    const html = renderToStaticMarkup(
      <TextField label="x" value="" onChange={vi.fn()} description="A short help line." />,
    );
    expect(html).toContain("A short help line.");
  });

  it("passes type=email when type=email", () => {
    const html = renderToStaticMarkup(
      <TextField label="Email" value="" onChange={vi.fn()} type="email" />,
    );
    expect(html).toContain('type="email"');
  });
});

describe("<SelectField>", () => {
  it("renders one <option> per option with the correct value/label", () => {
    const html = renderToStaticMarkup(
      <SelectField<string>
        label="Status"
        value="b"
        options={[
          { label: "Alpha", value: "a" },
          { label: "Bravo", value: "b" },
          { label: "Charlie", value: "c" },
        ]}
        onChange={vi.fn()}
      />,
    );
    expect(html).toMatch(/<option[^>]*value="a"/);
    expect(html).toMatch(/<option[^>]*value="b"/);
    expect(html).toMatch(/<option[^>]*value="c"/);
    expect(html).toContain("Alpha");
    expect(html).toContain("Bravo");
    expect(html).toContain("Charlie");
  });
});

describe("<CheckboxField>", () => {
  it("renders the checked attribute when value=true", () => {
    const html = renderToStaticMarkup(
      <CheckboxField label="Hide footer" value={true} onChange={vi.fn()} />,
    );
    expect(html).toMatch(/type="checkbox"[^>]*checked/);
  });

  it("omits the checked attribute when value=false", () => {
    const html = renderToStaticMarkup(
      <CheckboxField label="Hide footer" value={false} onChange={vi.fn()} />,
    );
    expect(html).toMatch(/type="checkbox"/);
    expect(html).not.toMatch(/type="checkbox"[^>]*checked/);
  });
});

describe("<NumberField>", () => {
  it("renders type=number and the min/max attrs", () => {
    const html = renderToStaticMarkup(
      <NumberField label="Opacity" value={0.3} onChange={vi.fn()} min={0} max={1} step={0.1} />,
    );
    expect(html).toContain('type="number"');
    expect(html).toContain('min="0"');
    expect(html).toContain('max="1"');
  });
});

describe("<ColorField>", () => {
  it("renders both a color picker swatch and a text input", () => {
    const html = renderToStaticMarkup(
      <ColorField label="Primary" value="#123456" onChange={vi.fn()} />,
    );
    expect(html).toContain('type="color"');
    expect(html).toContain('type="text"');
    expect(html).toContain('value="#123456"');
  });

  it("falls back the swatch to white when the value isn't a valid #rrggbb", () => {
    const html = renderToStaticMarkup(
      <ColorField label="Optional" value="" onChange={vi.fn()} isOptional />,
    );
    expect(html).toMatch(/type="color"[^>]*value="#ffffff"/);
  });
});

describe("<Field>", () => {
  it("wraps children with a label", () => {
    const html = renderToStaticMarkup(
      <Field label="Hello">
        <span>x</span>
      </Field>,
    );
    expect(html).toContain("Hello");
    expect(html).toContain("<span>x</span>");
  });
});

describe("<FieldGroup>", () => {
  it("renders a heading + description above its children", () => {
    const html = renderToStaticMarkup(
      <FieldGroup title="Identity" description="Who you are">
        <p>body</p>
      </FieldGroup>,
    );
    expect(html).toContain("Identity");
    expect(html).toContain("Who you are");
    expect(html).toContain("<p>body</p>");
  });
});
