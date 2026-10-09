"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CSSProperties } from "react";

import { FieldGroup, TextField } from "@/components/admin/form";

type Props = {
  artistName: string;
};

/**
 * "Reset site" action lives at the bottom of Site Settings.
 *
 * Three confirmation steps gate the destructive action:
 *   1. Click the red "Reset site" button (closed state by default).
 *   2. Open panel explains what will be deleted; artist clicks "I
 *      understand, continue".
 *   3. Artist types their artist name AND the literal phrase
 *      "delete my content"; only then the final Reset button is
 *      enabled.
 *
 * On reset the server clears every page + collection item, restores
 * default singletons, and flips `hasCompletedFirstRun` back to false.
 * Page redirect goes to /admin which then bounces to /admin/welcome.
 *
 * Multi-step confirmation is deliberate — no single misclick can wipe
 * the site. Mirrors the GitHub "delete repo" pattern.
 */

type Stage = "idle" | "warned" | "confirming";

const CONFIRM_PHRASE = "delete my content";

export function DangerZone({ artistName }: Props) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("idle");
  const [typedArtistName, setTypedArtistName] = useState("");
  const [typedPhrase, setTypedPhrase] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isArtistNameMatched =
    typedArtistName.trim().toLowerCase() === artistName.trim().toLowerCase() &&
    artistName.trim().length > 0;
  const isPhraseMatched = typedPhrase.trim().toLowerCase() === CONFIRM_PHRASE;
  const canReset = isArtistNameMatched && isPhraseMatched && !isSubmitting;

  function cancel() {
    setStage("idle");
    setTypedArtistName("");
    setTypedPhrase("");
    setErrorMessage(null);
  }

  async function handleReset() {
    if (!canReset) return;
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const res = await fetch("/api/welcome/reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmArtistName: typedArtistName }),
      });
      const body = (await res.json().catch(() => null)) as
        | { ok: true; itemsDeleted?: number }
        | { ok: false; error?: string }
        | null;
      if (!res.ok || !body || !body.ok) {
        setErrorMessage(
          (body && "error" in body && body.error) ||
            `Reset failed (HTTP ${res.status})`,
        );
        setIsSubmitting(false);
        return;
      }
      // Bounce to /admin so the first-run redirect catches and sends
      // the artist into the welcome wizard.
      router.replace("/admin");
      router.refresh();
    } catch (cause) {
      setErrorMessage(cause instanceof Error ? cause.message : "Reset failed");
      setIsSubmitting(false);
    }
  }

  return (
    <FieldGroup
      title="Danger zone"
      description="Irreversible actions. There's no undo button — once a reset commits, the previous content is only recoverable from the artist's git history."
    >
      <div style={dangerWellStyle}>
        {stage === "idle" ? (
          <div style={rowStyle}>
            <div>
              <div style={dangerHeadingStyle}>Reset site to first-run state</div>
              <div style={dangerBodyStyle}>
                Deletes every page, every collection item (tour dates, releases,
                posts, store items, photos, videos), and resets site settings,
                header, and appearance to their defaults. The welcome wizard
                runs again on next visit.
              </div>
            </div>
            <button
              type="button"
              onClick={() => setStage("warned")}
              style={dangerButtonStyle}
            >
              Reset site…
            </button>
          </div>
        ) : null}

        {stage === "warned" ? (
          <div>
            <div style={dangerHeadingStyle}>Are you sure?</div>
            <ul style={dangerListStyle}>
              <li>Every page on your site will be deleted.</li>
              <li>
                Every tour date, release, post, store item, photo, and video will
                be deleted.
              </li>
              <li>
                Site settings, header, and appearance will reset to defaults
                (including your artist name and social links).
              </li>
              <li>You will be sent back to the welcome wizard.</li>
              <li>
                This can&rsquo;t be undone from inside the editor &mdash; only
                by reverting the commit in your git history.
              </li>
            </ul>
            <div style={buttonRowStyle}>
              <button type="button" onClick={cancel} style={secondaryButtonStyle}>
                Cancel
              </button>
              <button
                type="button"
                onClick={() => setStage("confirming")}
                style={dangerButtonStyle}
              >
                I understand, continue
              </button>
            </div>
          </div>
        ) : null}

        {stage === "confirming" ? (
          <div>
            <div style={dangerHeadingStyle}>Final confirmation</div>
            <div style={dangerBodyStyle}>
              Type your artist name and the phrase below to enable the reset
              button. Both fields are case-insensitive but otherwise have to
              match exactly.
            </div>
            <TextField
              id="reset-artist-name"
              label={`Type your artist name: ${artistName || "(unset)"}`}
              value={typedArtistName}
              onChange={setTypedArtistName}
              placeholder={artistName}
            />
            <TextField
              id="reset-phrase"
              label={`Type the phrase: ${CONFIRM_PHRASE}`}
              value={typedPhrase}
              onChange={setTypedPhrase}
              placeholder={CONFIRM_PHRASE}
            />
            {errorMessage ? (
              <p role="alert" style={errorTextStyle}>
                {errorMessage}
              </p>
            ) : null}
            <div style={buttonRowStyle}>
              <button type="button" onClick={cancel} style={secondaryButtonStyle}>
                Cancel
              </button>
              <button
                type="button"
                onClick={handleReset}
                disabled={!canReset}
                style={canReset ? dangerButtonStyle : disabledButtonStyle}
              >
                {isSubmitting ? "Resetting…" : "Reset site"}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </FieldGroup>
  );
}

// ---------------------------------------------------------------------------
// Styles — design tokens only.
// ---------------------------------------------------------------------------

const dangerWellStyle: CSSProperties = {
  padding: "var(--space-4)",
  border: "1px solid var(--color-danger)",
  borderRadius: "var(--radius-sm)",
  background: "var(--color-surface)",
};

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: "var(--space-4)",
};

const dangerHeadingStyle: CSSProperties = {
  fontSize: "var(--font-size-sm)",
  fontWeight: "var(--font-weight-semibold)" as unknown as number,
  color: "var(--color-danger)",
  marginBottom: "var(--space-2)",
};

const dangerBodyStyle: CSSProperties = {
  fontSize: "var(--font-size-sm)",
  color: "var(--color-text-muted)",
  marginBottom: "var(--space-3)",
  lineHeight: "var(--line-height-base)",
};

const dangerListStyle: CSSProperties = {
  fontSize: "var(--font-size-sm)",
  color: "var(--color-text)",
  marginBottom: "var(--space-4)",
  paddingLeft: "var(--space-5)",
  lineHeight: "var(--line-height-base)",
};

const buttonRowStyle: CSSProperties = {
  display: "flex",
  gap: "var(--space-3)",
  justifyContent: "flex-end",
  marginTop: "var(--space-4)",
};

const dangerButtonStyle: CSSProperties = {
  padding: "var(--space-2) var(--space-4)",
  fontSize: "var(--font-size-sm)",
  fontWeight: "var(--font-weight-semibold)" as unknown as number,
  background: "var(--color-danger)",
  color: "var(--color-surface)",
  border: "none",
  borderRadius: "var(--radius-sm)",
  cursor: "pointer",
};

const disabledButtonStyle: CSSProperties = {
  ...dangerButtonStyle,
  background: "var(--color-border-strong)",
  cursor: "not-allowed",
};

const secondaryButtonStyle: CSSProperties = {
  padding: "var(--space-2) var(--space-4)",
  fontSize: "var(--font-size-sm)",
  fontWeight: "var(--font-weight-semibold)" as unknown as number,
  background: "transparent",
  color: "var(--color-text-emphasis)",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "var(--radius-sm)",
  cursor: "pointer",
};

const errorTextStyle: CSSProperties = {
  fontSize: "var(--font-size-sm)",
  color: "var(--color-danger)",
  margin: "var(--space-2) 0",
};
