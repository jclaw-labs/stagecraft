"use client";

import { AdminPanel } from "@/components/admin/AdminPanel";
import {
  ColorField,
  FieldGroup,
  SelectField,
  TextField,
} from "@/components/admin/form";
import { SaveBar } from "@/components/admin/SaveBar";
import { useSettingsForm } from "@/components/admin/useSettingsForm";
import { appearanceToItemValues } from "@/lib/collections/migrate-from-legacy-values";
import {
  COLOR_FIELDS,
  COLOR_FIELD_LABELS,
  FONT_WEIGHTS,
  HEADING_MODES,
  HEADING_MODE_LABELS,
  type Appearance,
  type FontWeight,
  type HeadingMode,
} from "@/lib/site-config-types";

type Props = {
  initial: Appearance;
  /** Badge the panel title when the `appearance` singleton has unpublished edits. */
  hasPendingChanges?: boolean;
};

const WEIGHT_OPTIONS = FONT_WEIGHTS.map((w) => ({ label: String(w), value: String(w) }));

/**
 * Appearance editor — colors and typography.
 *
 * Colors are nine named tokens; each gets a swatch + text input so authors
 * can either pick from the system color wheel or paste a hex. Typography
 * splits into Body + Headings; choosing "Different font for headings"
 * reveals the heading-font row. Free-text font family is intentional for
 * now — any Google Font name works; a curated picker can land later.
 */
export function AppearanceForm({ initial, hasPendingChanges }: Props) {
  const form = useSettingsForm<Appearance>({
    initial,
    collectionSlug: "appearance",
    toValues: appearanceToItemValues,
  });

  function setColor(field: (typeof COLOR_FIELDS)[number], value: string) {
    form.setValue((prev) => ({
      ...prev,
      colors: { ...prev.colors, [field]: value },
    }));
  }

  function setTypography<K extends keyof Appearance["typography"]>(
    key: K,
    value: Appearance["typography"][K],
  ) {
    form.setValue((prev) => ({
      ...prev,
      typography: { ...prev.typography, [key]: value },
    }));
  }

  function setBodyWeight(role: keyof Appearance["typography"]["bodyWeights"], value: FontWeight) {
    form.setValue((prev) => ({
      ...prev,
      typography: {
        ...prev.typography,
        bodyWeights: { ...prev.typography.bodyWeights, [role]: value },
      },
    }));
  }

  function setHeadingWeight(role: keyof Appearance["typography"]["headingWeights"], value: FontWeight) {
    form.setValue((prev) => ({
      ...prev,
      typography: {
        ...prev.typography,
        headingWeights: { ...prev.typography.headingWeights, [role]: value },
      },
    }));
  }

  return (
    <AdminPanel
      title="Appearance"
      description="Colors and typography for the public site. Changes here update the CSS custom properties injected on every page."
      hasPendingChanges={hasPendingChanges}
      saveBar={<SaveBar {...form.saveBarProps} />}
    >
      <FieldGroup
        title="Colors"
        description="Each color maps to a CSS custom property used across the site. Use the swatch to pick from a color wheel, or paste any CSS color value into the text input."
      >
        {COLOR_FIELDS.map((field) => (
          <ColorField
            key={field}
            id={`color-${field}`}
            label={COLOR_FIELD_LABELS[field]}
            value={form.value.colors[field]}
            onChange={(v) => setColor(field, v)}
            isOptional={field === "linkColor"}
          />
        ))}
      </FieldGroup>

      <FieldGroup
        title="Body typography"
        description="Font family and weights for body copy. The body font is also the fallback when headings inherit it."
      >
        <TextField
          id="bodyFont"
          label="Body font family"
          description="Any Google Font name (case-sensitive). Capitalised with letters/digits/spaces only — e.g. 'Inter', 'IBM Plex Sans', 'Space Grotesk'."
          value={form.value.typography.bodyFont}
          onChange={(v) => setTypography("bodyFont", v)}
          isRequired
        />
        <SelectField<string>
          id="bodyWeight"
          label="Body weight"
          description="Weight used by paragraph text and most UI."
          value={String(form.value.typography.bodyWeights.body)}
          options={WEIGHT_OPTIONS}
          onChange={(v) => setBodyWeight("body", Number(v) as FontWeight)}
        />
        <SelectField<string>
          id="bodyBoldWeight"
          label="Bold weight"
          description="Used for <strong> emphasis. Some families don't ship every weight — check fonts.google.com if a weight looks wrong."
          value={String(form.value.typography.bodyWeights.bodyBold)}
          options={WEIGHT_OPTIONS}
          onChange={(v) => setBodyWeight("bodyBold", Number(v) as FontWeight)}
        />
      </FieldGroup>

      <FieldGroup
        title="Heading typography"
        description="Same font as the body, or a separate font for h1–h3."
      >
        <SelectField<HeadingMode>
          id="headingMode"
          label="Heading font mode"
          value={form.value.typography.headingMode}
          options={HEADING_MODES.map((m) => ({ label: HEADING_MODE_LABELS[m], value: m }))}
          onChange={(v) => setTypography("headingMode", v)}
        />
        {form.value.typography.headingMode === "split" ? (
          <TextField
            id="headingFont"
            label="Heading font family"
            description="Used for h1–h3. Same naming rules as the body font."
            value={form.value.typography.headingFont}
            onChange={(v) => setTypography("headingFont", v)}
            placeholder="e.g. Merriweather"
          />
        ) : null}
        <SelectField<string>
          id="h1Weight"
          label="H1 weight"
          value={String(form.value.typography.headingWeights.h1)}
          options={WEIGHT_OPTIONS}
          onChange={(v) => setHeadingWeight("h1", Number(v) as FontWeight)}
        />
        <SelectField<string>
          id="h2Weight"
          label="H2 weight"
          value={String(form.value.typography.headingWeights.h2)}
          options={WEIGHT_OPTIONS}
          onChange={(v) => setHeadingWeight("h2", Number(v) as FontWeight)}
        />
        <SelectField<string>
          id="h3Weight"
          label="H3 weight"
          value={String(form.value.typography.headingWeights.h3)}
          options={WEIGHT_OPTIONS}
          onChange={(v) => setHeadingWeight("h3", Number(v) as FontWeight)}
        />
      </FieldGroup>
    </AdminPanel>
  );
}
