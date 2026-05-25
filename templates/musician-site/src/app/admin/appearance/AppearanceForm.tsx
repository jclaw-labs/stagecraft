"use client";

import type { CSSProperties } from "react";

import { AdminPanel } from "@/components/admin/AdminPanel";
import {
  ColorField,
  FieldGroup,
  SelectField,
} from "@/components/admin/form";
import { SaveBar } from "@/components/admin/SaveBar";
import { useSettingsForm } from "@/components/admin/useSettingsForm";
import { checkAppearanceContrast } from "@/lib/contrast";
import { FontPickerField } from "./FontPickerField";
import { appearanceToItemValues } from "@/lib/collections/migrate-from-legacy-values";
import {
  ACCENT_MODES,
  BUTTON_FILLS,
  BUTTON_SHAPES,
  COLOR_FIELDS,
  COLOR_FIELD_LABELS,
  CONTENT_WIDTHS,
  DEFAULT_DESIGN,
  DENSITIES,
  FONT_WEIGHTS,
  FOOTER_STYLES,
  GALLERY_LAYOUTS,
  GUTTERS,
  HEADING_CASES,
  HEADING_MODES,
  HEADING_MODE_LABELS,
  HEADING_SCALES,
  HEADING_TRACKINGS,
  IMAGE_TREATMENTS,
  RADII,
  RULE_STYLES,
  SECTION_ALIGNS,
  SHADOW_STYLES,
  type Appearance,
  type Design,
  type FontWeight,
  type HeadingMode,
} from "@/lib/site-config-types";

type Props = {
  initial: Appearance;
  /** Badge the panel title when the `appearance` singleton has unpublished edits. */
  hasPendingChanges?: boolean;
};

const WEIGHT_OPTIONS = FONT_WEIGHTS.map((w) => ({ label: String(w), value: String(w) }));

// Title-case a hyphenated enum value for a select label ("hard-offset" → "Hard offset").
function label(v: string): string {
  const s = v.replace(/-/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function opts(values: readonly string[]) {
  return values.map((v) => ({ label: label(v), value: v }));
}

const contrastBoxStyle: CSSProperties = {
  marginBottom: "var(--space-4)",
  padding: "var(--space-3)",
  border: "1px solid var(--color-danger)",
  borderRadius: "var(--radius-sm)",
  background: "var(--color-surface-subtle)",
};

/**
 * Non-blocking WCAG-AA advisory. Lists the legibility-critical colour pairs
 * (from `checkAppearanceContrast`) that fall below 4.5:1 so the artist sees
 * unreadable combinations before publishing — but never prevents a save.
 */
function ContrastWarnings({
  colors,
  onAccent,
}: {
  colors: Appearance["colors"];
  onAccent: string;
}) {
  const issues = checkAppearanceContrast(colors, onAccent).filter((r) => !r.passesAA);
  if (issues.length === 0) return null;
  return (
    <div style={contrastBoxStyle} role="status">
      <strong
        style={{
          display: "block",
          marginBottom: "var(--space-1)",
          fontSize: "var(--font-size-sm)",
          color: "var(--color-text-emphasis)",
        }}
      >
        Contrast check — {issues.length} pair{issues.length > 1 ? "s" : ""} below WCAG AA (4.5:1)
      </strong>
      <ul style={{ margin: 0, paddingLeft: "var(--space-4)" }}>
        {issues.map((issue) => (
          <li
            key={issue.label}
            style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)" }}
          >
            {issue.label}:{" "}
            <span style={{ color: "var(--color-text-error)", fontWeight: "var(--font-weight-semibold)" as unknown as number }}>
              {issue.ratio.toFixed(1)}:1
            </span>
          </li>
        ))}
      </ul>
      <p
        style={{
          margin: "var(--space-1) 0 0",
          fontSize: "var(--font-size-xs)",
          color: "var(--color-text-muted)",
          lineHeight: "var(--line-height-base)",
        }}
      >
        Low-contrast text is hard to read and fails accessibility guidelines. This is a
        heads-up, not a block — you can still save.
      </p>
    </div>
  );
}

/**
 * Appearance editor — colors, typography, and the design-token system
 * (layout, shape, and detail controls per ADR-013). Colors + type are the
 * common knobs; the Layout / Shape / Detail groups carry the structural
 * controls that, together with a preset, make a full theme. Free-text font
 * family is intentional; a curated picker can land later.
 */
export function AppearanceForm({ initial, hasPendingChanges }: Props) {
  const form = useSettingsForm<Appearance>({
    initial,
    collectionSlug: "appearance",
    toValues: appearanceToItemValues,
  });

  const design: Design = form.value.design ?? DEFAULT_DESIGN;

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

  function setDesign<K extends keyof Design>(key: K, value: Design[K]) {
    form.setValue((prev) => ({
      ...prev,
      design: { ...(prev.design ?? DEFAULT_DESIGN), [key]: value },
    }));
  }

  function setGradient(key: keyof Design["accentGradient"], value: string) {
    form.setValue((prev) => {
      const d = prev.design ?? DEFAULT_DESIGN;
      return { ...prev, design: { ...d, accentGradient: { ...d.accentGradient, [key]: value } } };
    });
  }

  return (
    <AdminPanel
      title="Appearance"
      description="Colors, typography, and layout for the public site. Changes update the CSS custom properties injected on every page."
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
        <ContrastWarnings colors={form.value.colors} onAccent={design.onAccent} />
      </FieldGroup>

      <FieldGroup
        title="Body typography"
        description="Font family and weights for body copy. The body font is also the fallback when headings inherit it."
      >
        <FontPickerField
          id="bodyFont"
          label="Body font family"
          description="Pick a category, then a family — or choose Custom to type any Google Font name."
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
        description="Same font as the body, or a separate font for h1–h3. An optional display font styles the wordmark + hero."
      >
        <SelectField<HeadingMode>
          id="headingMode"
          label="Heading font mode"
          value={form.value.typography.headingMode}
          options={HEADING_MODES.map((m) => ({ label: HEADING_MODE_LABELS[m], value: m }))}
          onChange={(v) => setTypography("headingMode", v)}
        />
        {form.value.typography.headingMode === "split" ? (
          <FontPickerField
            id="headingFont"
            label="Heading font family"
            description="Used for h1–h3. Pick a family or choose Custom."
            value={form.value.typography.headingFont}
            onChange={(v) => setTypography("headingFont", v)}
          />
        ) : null}
        <FontPickerField
          id="displayFont"
          label="Display font (optional)"
          description="Styles the wordmark + hero only. Choose Custom and leave it blank to inherit the heading font."
          value={form.value.typography.displayFont ?? ""}
          onChange={(v) => setTypography("displayFont", v)}
          placeholder="e.g. Anton (blank = inherit)"
        />
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

      <FieldGroup
        title="Layout"
        description="Spacing, measure, and alignment for the whole site."
      >
        <SelectField<string>
          id="density"
          label="Density"
          description="Vertical rhythm + section padding."
          value={design.density}
          options={opts(DENSITIES)}
          onChange={(v) => setDesign("density", v as Design["density"])}
        />
        <SelectField<string>
          id="contentWidth"
          label="Content width"
          value={design.contentWidth}
          options={opts(CONTENT_WIDTHS)}
          onChange={(v) => setDesign("contentWidth", v as Design["contentWidth"])}
        />
        <SelectField<string>
          id="sectionAlign"
          label="Section alignment"
          value={design.sectionAlign}
          options={opts(SECTION_ALIGNS)}
          onChange={(v) => setDesign("sectionAlign", v as Design["sectionAlign"])}
        />
        <SelectField<string>
          id="gutter"
          label="Grid gutter"
          value={design.gutter}
          options={opts(GUTTERS)}
          onChange={(v) => setDesign("gutter", v as Design["gutter"])}
        />
      </FieldGroup>

      <FieldGroup
        title="Shape &amp; components"
        description="Corner radius, buttons, shadows, rules, and image treatment."
      >
        <SelectField<string>
          id="radius"
          label="Corner radius"
          value={design.radius}
          options={opts(RADII)}
          onChange={(v) => setDesign("radius", v as Design["radius"])}
        />
        <SelectField<string>
          id="buttonShape"
          label="Button shape"
          value={design.buttonShape}
          options={opts(BUTTON_SHAPES)}
          onChange={(v) => setDesign("buttonShape", v as Design["buttonShape"])}
        />
        <SelectField<string>
          id="buttonFill"
          label="Button style"
          value={design.buttonFill}
          options={opts(BUTTON_FILLS)}
          onChange={(v) => setDesign("buttonFill", v as Design["buttonFill"])}
        />
        <SelectField<string>
          id="shadowStyle"
          label="Shadow"
          value={design.shadowStyle}
          options={opts(SHADOW_STYLES)}
          onChange={(v) => setDesign("shadowStyle", v as Design["shadowStyle"])}
        />
        <SelectField<string>
          id="ruleStyle"
          label="Divider / rule"
          value={design.ruleStyle}
          options={opts(RULE_STYLES)}
          onChange={(v) => setDesign("ruleStyle", v as Design["ruleStyle"])}
        />
        <SelectField<string>
          id="imageTreatment"
          label="Image treatment"
          value={design.imageTreatment}
          options={opts(IMAGE_TREATMENTS)}
          onChange={(v) => setDesign("imageTreatment", v as Design["imageTreatment"])}
        />
        <SelectField<string>
          id="galleryLayout"
          label="Gallery layout"
          value={design.galleryLayout}
          options={opts(GALLERY_LAYOUTS)}
          onChange={(v) => setDesign("galleryLayout", v as Design["galleryLayout"])}
        />
      </FieldGroup>

      <FieldGroup
        title="Detail"
        description="Heading treatment, accent style, footer, and texture."
      >
        <SelectField<string>
          id="headingCase"
          label="Heading case"
          value={design.headingCase}
          options={opts(HEADING_CASES)}
          onChange={(v) => setDesign("headingCase", v as Design["headingCase"])}
        />
        <SelectField<string>
          id="headingTracking"
          label="Heading letter-spacing"
          value={design.headingTracking}
          options={opts(HEADING_TRACKINGS)}
          onChange={(v) => setDesign("headingTracking", v as Design["headingTracking"])}
        />
        <SelectField<string>
          id="headingScale"
          label="Heading scale"
          value={design.headingScale}
          options={opts(HEADING_SCALES)}
          onChange={(v) => setDesign("headingScale", v as Design["headingScale"])}
        />
        <SelectField<string>
          id="footerStyle"
          label="Footer style"
          value={design.footerStyle}
          options={opts(FOOTER_STYLES)}
          onChange={(v) => setDesign("footerStyle", v as Design["footerStyle"])}
        />
        <ColorField
          id="onAccent"
          label="Text on accent / buttons"
          value={design.onAccent}
          onChange={(v) => setDesign("onAccent", v)}
          isOptional
        />
        <SelectField<string>
          id="accentMode"
          label="Accent style"
          value={design.accentMode}
          options={opts(ACCENT_MODES)}
          onChange={(v) => setDesign("accentMode", v as Design["accentMode"])}
        />
        {design.accentMode === "gradient" ? (
          <>
            <ColorField
              id="gradientFrom"
              label="Gradient — from"
              value={design.accentGradient.from}
              onChange={(v) => setGradient("from", v)}
            />
            <ColorField
              id="gradientVia"
              label="Gradient — via (optional)"
              value={design.accentGradient.via}
              onChange={(v) => setGradient("via", v)}
              isOptional
            />
            <ColorField
              id="gradientTo"
              label="Gradient — to"
              value={design.accentGradient.to}
              onChange={(v) => setGradient("to", v)}
            />
          </>
        ) : null}
        <SelectField<string>
          id="grain"
          label="Film grain overlay"
          value={design.grain ? "on" : "off"}
          options={[
            { label: "Off", value: "off" },
            { label: "On", value: "on" },
          ]}
          onChange={(v) => setDesign("grain", v === "on")}
        />
      </FieldGroup>
    </AdminPanel>
  );
}
