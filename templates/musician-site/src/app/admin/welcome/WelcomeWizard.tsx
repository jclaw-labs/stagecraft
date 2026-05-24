"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CSSProperties } from "react";

import {
  ColorField,
  Field,
  TextField,
} from "@/components/admin/form";
import { ImagePickerField } from "@/puck/ImagePickerField";
import { DEFAULT_THEME_ID, THEME_IDS, THEME_PRESETS } from "@/lib/theme-presets";

import {
  buildWelcomePayload,
  WELCOME_STEPS,
  type WelcomeFormValues,
  type WelcomeStep,
} from "./welcome-steps";

type Props = {
  email: string;
  initialArtistName: string;
  initialPrimaryColor: string;
};

/**
 * Four-step welcome wizard for fresh artist sites. Each step is just a
 * `<form>` with a Next button; the last step's Next is "Set up my site"
 * and POSTs to `/api/welcome/complete`.
 *
 * The wizard owns its draft state. Nothing is written until the artist
 * hits the final Set-up button, so a refresh mid-flow loses the typed
 * values — which is fine because the server prefills from the
 * existing singletons (which are still default-empty before the
 * wizard completes).
 *
 * Pure client component; no useSettingsForm because the dirty-tracking
 * + per-field save model doesn't fit a multi-step single-commit flow.
 */
export function WelcomeWizard({
  email,
  initialArtistName,
  initialPrimaryColor,
}: Props) {
  const router = useRouter();
  const [step, setStep] = useState<WelcomeStep>(WELCOME_STEPS[0]);
  const [values, setValues] = useState<WelcomeFormValues>({
    artistName: initialArtistName,
    start: DEFAULT_THEME_ID,
    primaryColor: initialPrimaryColor || "#0f3460",
    wordmark: null,
    firstPageTitle: "Home",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function setField<K extends keyof WelcomeFormValues>(
    key: K,
    val: WelcomeFormValues[K],
  ) {
    setValues((prev) => ({ ...prev, [key]: val }));
  }

  const currentIndex = WELCOME_STEPS.indexOf(step);
  const isLastStep = currentIndex === WELCOME_STEPS.length - 1;

  function canAdvance(): boolean {
    switch (step) {
      case "name":
        return values.artistName.trim().length > 0;
      case "start":
        // A theme is always preselected; only the custom path needs a
        // non-empty colour.
        return values.start !== "custom" || values.primaryColor.trim().length > 0;
      case "wordmark":
        return true; // optional
      case "firstPage":
        return values.firstPageTitle.trim().length > 0;
    }
  }

  async function handleNext(event: React.FormEvent) {
    event.preventDefault();
    if (!canAdvance()) return;
    if (!isLastStep) {
      setStep(WELCOME_STEPS[currentIndex + 1]);
      return;
    }
    await submit();
  }

  async function submit() {
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const res = await fetch("/api/welcome/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildWelcomePayload(values)),
      });
      const body = (await res.json().catch(() => null)) as
        | { ok: true; publishWarning?: string }
        | { ok: false; error?: string }
        | null;
      if (!res.ok || !body || !body.ok) {
        setErrorMessage(
          (body && "error" in body && body.error) ||
            `Set-up failed (HTTP ${res.status})`,
        );
        setIsSubmitting(false);
        return;
      }
      router.replace("/admin/pages");
      router.refresh();
    } catch (cause) {
      setErrorMessage(cause instanceof Error ? cause.message : "Set-up failed");
      setIsSubmitting(false);
    }
  }

  function handleBack() {
    if (currentIndex === 0) return;
    setStep(WELCOME_STEPS[currentIndex - 1]);
  }

  return (
    <main style={shellStyle}>
      <div style={frameStyle}>
        <Header email={email} stepIndex={currentIndex} totalSteps={WELCOME_STEPS.length} />

        <form onSubmit={handleNext} style={formStyle}>
          <StepContent step={step} values={values} setField={setField} />

          {errorMessage ? (
            <p role="alert" style={errorStyle}>
              {errorMessage}
            </p>
          ) : null}

          <div style={footerStyle}>
            {currentIndex > 0 ? (
              <button
                type="button"
                onClick={handleBack}
                style={secondaryButtonStyle}
                disabled={isSubmitting}
              >
                Back
              </button>
            ) : (
              <span />
            )}
            <button
              type="submit"
              style={primaryButtonStyle}
              disabled={!canAdvance() || isSubmitting}
            >
              {isLastStep
                ? isSubmitting
                  ? "Setting up…"
                  : "Set up my site"
                : "Next"}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}

export function StepContent({
  step,
  values,
  setField,
}: {
  step: WelcomeStep;
  values: WelcomeFormValues;
  setField: <K extends keyof WelcomeFormValues>(
    key: K,
    val: WelcomeFormValues[K],
  ) => void;
}) {
  switch (step) {
    case "name":
      return (
        <>
          <h2 style={headingStyle}>What&rsquo;s your artist name?</h2>
          <p style={bodyStyle}>
            We&rsquo;ll use it for the document title, the footer copyright,
            and the header (until you upload a wordmark image). You can
            change it later from Site Settings.
          </p>
          <TextField
            id="welcome-artistName"
            label="Artist name"
            value={values.artistName}
            onChange={(v) => setField("artistName", v)}
            placeholder="e.g. Nova Reyes"
            isRequired
          />
        </>
      );
    case "start":
      return (
        <>
          <h2 style={headingStyle}>Choose a starting point.</h2>
          <p style={bodyStyle}>
            A theme sets your colours, fonts, and header in one go — you
            can fine-tune all of it later from Appearance. Or start from a
            single accent colour, or a blank page.
          </p>
          <div role="radiogroup" aria-label="Starting point" style={cardGridStyle}>
            {THEME_IDS.map((id) => {
              const preset = THEME_PRESETS[id];
              const { colors } = preset.appearance;
              return (
                <StartCard
                  key={id}
                  selected={values.start === id}
                  name={preset.name}
                  description={preset.description}
                  swatches={[
                    colors.background,
                    colors.primary,
                    colors.secondary,
                    colors.accent,
                  ]}
                  onSelect={() => setField("start", id)}
                />
              );
            })}
            <StartCard
              selected={values.start === "custom"}
              name="Custom colour"
              description="One accent colour on the default palette."
              swatches={[values.primaryColor]}
              onSelect={() => setField("start", "custom")}
            />
            <StartCard
              selected={values.start === "empty"}
              name="Start empty"
              description="A blank page with the default theme — build it yourself."
              onSelect={() => setField("start", "empty")}
            />
          </div>
          {values.start === "custom" ? (
            <div style={customColorWrapStyle}>
              <ColorField
                id="welcome-primaryColor"
                label="Primary color"
                value={values.primaryColor}
                onChange={(v) => setField("primaryColor", v)}
              />
            </div>
          ) : null}
        </>
      );
    case "wordmark":
      return (
        <>
          <h2 style={headingStyle}>Upload a wordmark (optional).</h2>
          <p style={bodyStyle}>
            An image shown in the header instead of the artist-name text.
            PNG with transparency works best. Skip to use the artist name
            as plain text — you can upload one later from Header &
            Navigation.
          </p>
          <Field
            label="Wordmark image"
            description="Optional. Skip with the Next button if you'd rather text."
          >
            <ImagePickerField
              value={values.wordmark}
              onChange={(next) => setField("wordmark", next)}
            />
          </Field>
        </>
      );
    case "firstPage":
      return (
        <>
          <h2 style={headingStyle}>Name your first page.</h2>
          <p style={bodyStyle}>
            We&rsquo;ll create a starter Home page with a hero and a couple
            of section blocks for you to edit. Most sites just call this
            &ldquo;Home&rdquo;; for splashier sites try the album name or a
            song title.
          </p>
          <TextField
            id="welcome-firstPageTitle"
            label="First page title"
            value={values.firstPageTitle}
            onChange={(v) => setField("firstPageTitle", v)}
            placeholder="Home"
            isRequired
          />
        </>
      );
  }
}

function StartCard({
  selected,
  name,
  description,
  swatches,
  onSelect,
}: {
  selected: boolean;
  name: string;
  description: string;
  swatches?: string[];
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      style={selected ? selectedCardStyle : cardStyle}
    >
      {swatches && swatches.length > 0 ? (
        <span style={swatchRowStyle} aria-hidden="true">
          {swatches.map((color, i) => (
            <span key={i} style={{ ...swatchStyle, background: color }} />
          ))}
        </span>
      ) : (
        <span style={emptySwatchStyle} aria-hidden="true" />
      )}
      <span style={cardNameStyle}>{name}</span>
      <span style={cardDescStyle}>{description}</span>
    </button>
  );
}

function Header({
  email,
  stepIndex,
  totalSteps,
}: {
  email: string;
  stepIndex: number;
  totalSteps: number;
}) {
  return (
    <div style={headerWrapStyle}>
      <div>
        <p style={eyebrowStyle}>Welcome</p>
        <h1 style={titleStyle}>Let&rsquo;s set up your site.</h1>
        {email ? <p style={emailStyle}>Signed in as {email}</p> : null}
      </div>
      <div style={progressStyle} aria-label={`Step ${stepIndex + 1} of ${totalSteps}`}>
        Step {stepIndex + 1} / {totalSteps}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles — design tokens only (CLAUDE.md §7).
// ---------------------------------------------------------------------------

const shellStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: "100vh",
  padding: "var(--space-6)",
  background: "var(--color-background)",
};

const frameStyle: CSSProperties = {
  width: "100%",
  maxWidth: "var(--max-width-narrow)",
  background: "var(--color-surface)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-md)",
  padding: "var(--space-8)",
  boxShadow: "var(--shadow-md)",
};

const headerWrapStyle: CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  marginBottom: "var(--space-6)",
  gap: "var(--space-4)",
};

const eyebrowStyle: CSSProperties = {
  fontSize: "var(--font-size-xs)",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "var(--color-text-muted)",
  margin: 0,
  fontWeight: "var(--font-weight-semibold)" as unknown as number,
};

const titleStyle: CSSProperties = {
  fontSize: "var(--font-size-xl)",
  fontWeight: "var(--font-weight-semibold)" as unknown as number,
  margin: "var(--space-1) 0 0 0",
  color: "var(--color-text-emphasis)",
};

const emailStyle: CSSProperties = {
  fontSize: "var(--font-size-xs)",
  color: "var(--color-text-muted)",
  margin: "var(--space-2) 0 0 0",
};

const progressStyle: CSSProperties = {
  fontSize: "var(--font-size-xs)",
  color: "var(--color-text-muted)",
  fontWeight: "var(--font-weight-semibold)" as unknown as number,
};

const formStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
};

const headingStyle: CSSProperties = {
  fontSize: "var(--font-size-lg)",
  fontWeight: "var(--font-weight-semibold)" as unknown as number,
  margin: "0 0 var(--space-2) 0",
  color: "var(--color-text-emphasis)",
};

const bodyStyle: CSSProperties = {
  fontSize: "var(--font-size-sm)",
  color: "var(--color-text-muted)",
  margin: "0 0 var(--space-5) 0",
  lineHeight: "var(--line-height-base)",
};

const cardGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(9rem, 1fr))",
  gap: "var(--space-3)",
};

const cardStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "stretch",
  gap: "var(--space-2)",
  padding: "var(--space-3)",
  textAlign: "left",
  background: "var(--color-surface)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-sm)",
  cursor: "pointer",
};

const selectedCardStyle: CSSProperties = {
  ...cardStyle,
  // Override the full `border` shorthand (not just borderColor) so we
  // never mix shorthand + longhand across a re-render — React warns
  // about that and it can drop the property. The 1px border + 1px
  // outline in the same colour reads as a clear 2px ring with no
  // layout shift.
  border: "1px solid var(--color-text-emphasis)",
  outline: "1px solid var(--color-text-emphasis)",
};

const swatchRowStyle: CSSProperties = {
  display: "flex",
  gap: "var(--space-1)",
  width: "100%",
};

const swatchStyle: CSSProperties = {
  flex: 1,
  height: "1.5rem",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--color-border)",
};

const emptySwatchStyle: CSSProperties = {
  width: "100%",
  height: "1.5rem",
  borderRadius: "var(--radius-sm)",
  border: "1px dashed var(--color-border-strong)",
  background: "var(--color-background)",
};

const cardNameStyle: CSSProperties = {
  fontSize: "var(--font-size-sm)",
  fontWeight: "var(--font-weight-semibold)" as unknown as number,
  color: "var(--color-text-emphasis)",
};

const cardDescStyle: CSSProperties = {
  fontSize: "var(--font-size-xs)",
  color: "var(--color-text-muted)",
  lineHeight: "var(--line-height-base)",
};

const customColorWrapStyle: CSSProperties = {
  marginTop: "var(--space-5)",
};

const errorStyle: CSSProperties = {
  fontSize: "var(--font-size-sm)",
  color: "var(--color-danger)",
  margin: "var(--space-2) 0 0 0",
};

const footerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  marginTop: "var(--space-6)",
  gap: "var(--space-3)",
};

const primaryButtonStyle: CSSProperties = {
  padding: "var(--space-2) var(--space-5)",
  fontSize: "var(--font-size-sm)",
  fontWeight: "var(--font-weight-semibold)" as unknown as number,
  background: "var(--color-text-emphasis)",
  color: "var(--color-surface)",
  border: "none",
  borderRadius: "var(--radius-sm)",
  cursor: "pointer",
};

const secondaryButtonStyle: CSSProperties = {
  padding: "var(--space-2) var(--space-5)",
  fontSize: "var(--font-size-sm)",
  fontWeight: "var(--font-weight-semibold)" as unknown as number,
  background: "transparent",
  color: "var(--color-text-emphasis)",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "var(--radius-sm)",
  cursor: "pointer",
};
