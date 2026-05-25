"use client";

import { useState, type CSSProperties, type ReactNode } from "react";

import { Field, inputStyle } from "@/components/admin/form";
import {
  FONT_CATEGORIES,
  FONT_CATEGORY_LABELS,
  GOOGLE_FONTS,
  fontCategoryForFamily,
  type FontCategory,
} from "@/lib/google-fonts";

const INHERIT = "__inherit__";
type PickerCategory = FontCategory | typeof INHERIT;

type Props = {
  id: string;
  label: string;
  description?: ReactNode;
  /** The persisted family string (e.g. "Inter"). Blank = unset / inherit. */
  value: string;
  onChange: (family: string) => void;
  isRequired?: boolean;
  placeholder?: string;
  /**
   * Offer a "None / inherit" choice (maps to an empty family string). For the
   * optional fonts (heading, display) where blank means "inherit".
   */
  allowInherit?: boolean;
  /** Label for the inherit choice + its hint, e.g. "Same as body". */
  inheritLabel?: string;
};

function initialCategory(value: string, allowInherit: boolean): PickerCategory {
  if (allowInherit && value.trim().length === 0) return INHERIT;
  return fontCategoryForFamily(value);
}

/**
 * Curated Google-Fonts picker: a category select + a family select, with a
 * "Custom" category that swaps the family select for a free-text input (any
 * Google Font name), and an optional "None / inherit" choice. Only the family
 * string is persisted — the category is derived from it.
 */
export function FontPickerField({
  id,
  label,
  description,
  value,
  onChange,
  isRequired,
  placeholder,
  allowInherit = false,
  inheritLabel = "None (inherit)",
}: Props) {
  // Local state so the picker remembers a "Custom" / "Inherit" choice even
  // when the typed value would derive to a different category. Initialised
  // from `value` once; in the Appearance form nothing changes `value` except
  // this field's own onChange. If an external rewrite is ever added (e.g.
  // "apply a preset to Appearance" or a form reset), this needs a resync —
  // tracked in design/DEFERRED.md.
  const [category, setCategory] = useState<PickerCategory>(() =>
    initialCategory(value, allowInherit),
  );

  function changeCategory(next: PickerCategory) {
    setCategory(next);
    if (next === INHERIT) {
      onChange("");
      return;
    }
    if (next !== "custom") {
      const fonts = GOOGLE_FONTS[next];
      // Snap to the first family of the new category unless the current value
      // already belongs to it, so the family select + persisted value agree.
      if (!fonts.some((f) => f.family === value)) onChange(fonts[0].family);
    }
  }

  const categoryOptions: Array<{ value: PickerCategory; label: string }> = [
    ...(allowInherit ? [{ value: INHERIT as PickerCategory, label: inheritLabel }] : []),
    ...FONT_CATEGORIES.map((c) => ({ value: c as PickerCategory, label: FONT_CATEGORY_LABELS[c] })),
  ];

  const familyOptions =
    category === INHERIT || category === "custom" ? [] : GOOGLE_FONTS[category];
  const familyValue = familyOptions.some((f) => f.family === value)
    ? value
    : (familyOptions[0]?.family ?? value);

  return (
    <Field label={label} description={description} htmlFor={id}>
      <div style={{ display: "flex", gap: "var(--space-2)" }}>
        <select
          aria-label={`${label} — category`}
          value={category}
          onChange={(e) => changeCategory(e.target.value as PickerCategory)}
          style={{ ...inputStyle, flex: "0 0 40%" }}
        >
          {categoryOptions.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        {category === INHERIT ? (
          <span style={inheritHintStyle}>{inheritLabel}</span>
        ) : category === "custom" ? (
          <input
            id={id}
            type="text"
            value={value}
            required={isRequired}
            placeholder={placeholder ?? "Any Google Font name"}
            onChange={(e) => onChange(e.target.value)}
            style={{ ...inputStyle, flex: 1 }}
          />
        ) : (
          <select
            id={id}
            aria-label={`${label} — family`}
            value={familyValue}
            onChange={(e) => onChange(e.target.value)}
            style={{ ...inputStyle, flex: 1 }}
          >
            {familyOptions.map((f) => (
              <option key={f.family} value={f.family}>
                {f.family}
              </option>
            ))}
          </select>
        )}
      </div>
    </Field>
  );
}

const inheritHintStyle: CSSProperties = {
  flex: 1,
  display: "flex",
  alignItems: "center",
  padding: "var(--space-2) var(--space-3)",
  fontSize: "var(--font-size-sm)",
  color: "var(--color-text-muted)",
  fontStyle: "italic",
};
