"use client";

import { AdminPanel } from "@/components/admin/AdminPanel";
import {
  CheckboxField,
  ColorField,
  Field,
  FieldGroup,
  SelectField,
  TextField,
} from "@/components/admin/form";
import { SaveBar } from "@/components/admin/SaveBar";
import { useSettingsForm } from "@/components/admin/useSettingsForm";
import { headerConfigToItemValues } from "@/lib/collections/migrate-from-legacy-values";
import { ImagePickerField } from "@/puck/ImagePickerField";
import {
  HEADER_LAYOUTS,
  HEADER_LAYOUT_LABELS,
  HEADER_MODES,
  HEADER_MODE_LABELS,
  WORDMARK_SIZE_ADJUSTMENTS,
  WORDMARK_SIZE_ADJUSTMENT_LABELS,
  isTransparentHeader,
  type HeaderConfig,
  type HeaderLayout,
  type HeaderMode,
} from "@/lib/site-config-types";

type Props = {
  initial: HeaderConfig;
};

/**
 * Header & Navigation editor. Two groups:
 *   1. Wordmark + sizing — drops in a brand image instead of the artist-name text.
 *   2. Header style — mode, layout, uppercase, subtitle, transparent-mode color.
 *
 * Nav order / per-page visibility live on the Pages list (drag-reorder +
 * eye toggle there) — not here. The single editor for both makes the
 * source-of-truth obvious and keeps this panel about chrome, not content.
 *
 * Edits go through the generic `PUT /api/collections/header/items/_singleton`
 * endpoint — the same path the generic editor uses.
 */
export function NavigationForm({ initial }: Props) {
  const form = useSettingsForm<HeaderConfig>({
    initial,
    collectionSlug: "header",
    toValues: headerConfigToItemValues,
  });

  function setField<K extends keyof HeaderConfig>(key: K, val: HeaderConfig[K]) {
    form.setValue((prev) => ({ ...prev, [key]: val }));
  }

  return (
    <AdminPanel
      title="Header & Navigation"
      description="Wordmark and header chrome (mode + layout + subtitle). The nav order itself is set on the Pages list — drag rows to reorder, toggle the eye to hide a page from the nav."
      saveBar={<SaveBar {...form.saveBarProps} />}
    >
      <FieldGroup
        title="Wordmark"
        description="An image shown in the header instead of the artist-name text. Upload here; remove to fall back to the text name from Site Settings."
      >
        <Field
          label="Wordmark image"
          description="PNG / SVG / JPG with transparency. Sized via the slider below."
        >
          <ImagePickerField
            value={form.value.wordmark}
            onChange={(next) => setField("wordmark", next)}
          />
        </Field>
        <SelectField<string>
          id="wordmarkSizeAdjust"
          label="Wordmark size"
          description="Coarse scale tweak for the wordmark image height. Only applies when a wordmark is set."
          value={String(form.value.wordmarkSizeAdjust)}
          options={WORDMARK_SIZE_ADJUSTMENTS.map((v) => ({
            label: WORDMARK_SIZE_ADJUSTMENT_LABELS[String(v)],
            value: String(v),
          }))}
          onChange={(v) => setField("wordmarkSizeAdjust", Number(v) as HeaderConfig["wordmarkSizeAdjust"])}
        />
      </FieldGroup>

      <FieldGroup
        title="Header style"
        description="Mode (solid vs transparent, sticky vs scrolling) and layout (logo + nav arrangement)."
      >
        <SelectField<HeaderMode>
          id="headerMode"
          label="Header mode"
          description="Pick how the header looks and behaves as the page scrolls. Transparent is meant to pair with a page that opens with a fullscreen hero — the nav sits over it and scrolls away."
          value={form.value.headerMode}
          options={HEADER_MODES.map((m) => ({ label: HEADER_MODE_LABELS[m], value: m }))}
          onChange={(v) => setField("headerMode", v)}
        />
        {isTransparentHeader(form.value.headerMode) ? (
          <ColorField
            id="headerForegroundColor"
            label="Header foreground color"
            description="Only used in transparent mode. Pick a color that reads against your hero image. Leave blank to inherit the body text color."
            value={form.value.headerForegroundColor}
            onChange={(v) => setField("headerForegroundColor", v)}
            isOptional
          />
        ) : null}
        <SelectField<HeaderLayout>
          id="headerLayout"
          label="Header layout"
          description="How the logo and navigation are arranged. The two centered variants suit more editorial sites."
          value={form.value.headerLayout}
          options={HEADER_LAYOUTS.map((l) => ({ label: HEADER_LAYOUT_LABELS[l], value: l }))}
          onChange={(v) => setField("headerLayout", v)}
        />
        <CheckboxField
          id="isHeaderTextUppercase"
          label="Uppercase header text"
          description="Renders the artist name in uppercase with slight extra letter-spacing. Only affects the text variant; wordmark images aren't transformed."
          value={form.value.isHeaderTextUppercase}
          onChange={(v) => setField("isHeaderTextUppercase", v)}
        />
        <TextField
          id="headerSubtitle"
          label="Header subtitle (optional)"
          description="Small second line under the artist name — a tagline, location, or role. Hidden automatically when a wordmark image is in use."
          value={form.value.headerSubtitle}
          onChange={(v) => setField("headerSubtitle", v)}
        />
      </FieldGroup>

    </AdminPanel>
  );
}
