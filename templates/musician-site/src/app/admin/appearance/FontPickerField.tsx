"use client";

import { useState, type ReactNode } from "react";

import { Field, inputStyle } from "@/components/admin/form";
import {
  FONT_CATEGORIES,
  FONT_CATEGORY_LABELS,
  GOOGLE_FONTS,
  fontCategoryForFamily,
  type FontCategory,
} from "@/lib/google-fonts";

type Props = {
  id: string;
  label: string;
  description?: ReactNode;
  /** The persisted family string (e.g. "Inter"). Blank = unset / inherit. */
  value: string;
  onChange: (family: string) => void;
  isRequired?: boolean;
  placeholder?: string;
};

/**
 * Curated Google-Fonts picker: a category select + a family select, with a
 * "Custom" category that swaps the family select for a free-text input (any
 * Google Font name). Only the family string is persisted — the category is
 * derived from it (and held locally so "Custom" sticks even when the typed
 * name happens to match a curated family).
 */
export function FontPickerField({
  id,
  label,
  description,
  value,
  onChange,
  isRequired,
  placeholder,
}: Props) {
  const [category, setCategory] = useState<FontCategory>(() => fontCategoryForFamily(value));

  function changeCategory(next: FontCategory) {
    setCategory(next);
    if (next !== "custom") {
      const fonts = GOOGLE_FONTS[next];
      // Snap to the first family of the new category unless the current value
      // already belongs to it, so the family select + persisted value agree.
      if (!fonts.some((f) => f.family === value)) onChange(fonts[0].family);
    }
  }

  const isCustom = category === "custom";
  const familyOptions = isCustom ? [] : GOOGLE_FONTS[category];
  const familyValue = familyOptions.some((f) => f.family === value)
    ? value
    : (familyOptions[0]?.family ?? value);

  return (
    <Field label={label} description={description} htmlFor={id}>
      <div style={{ display: "flex", gap: "var(--space-2)" }}>
        <select
          aria-label={`${label} — category`}
          value={category}
          onChange={(e) => changeCategory(e.target.value as FontCategory)}
          style={{ ...inputStyle, flex: "0 0 40%" }}
        >
          {FONT_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {FONT_CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
        {isCustom ? (
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
