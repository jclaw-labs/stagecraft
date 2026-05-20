"use client";

import { Puck } from "@measured/puck";
import "@measured/puck/puck.css";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { AdminAccountButton } from "@/components/admin/AdminAccountButton";
import { useBeforeUnloadIfDirty } from "@/components/admin/useBeforeUnloadIfDirty";
import { puckConfig } from "@/puck/config";
import type { PageData } from "@/lib/content";
import type { DeployState } from "@/lib/deploy-status";

type Props = {
  initialData: PageData;
  pageSlug: string;
  email: string;
};

/**
 * Publish lifecycle:
 *   idle → publishing → queued → building → live
 *                                    ↘ stalled (poll timeout, build still running)
 *   any → error(message)
 *
 * "publishing" = the /api/publish round-trip (broker → GitHub commit).
 * "queued"     = commit on disk on the artist's repo, deploy not yet started.
 * "building"   = deploy actively building on Vercel/Netlify.
 * "live"       = the public site now serves the new commit (provider state=ready).
 * "stalled"    = poll timed out at ~90s; build may still be running, but we
 *                stop polling so we don't spin forever.
 *
 * Provider state comes from `GET /api/publish-status`, which proxies to the
 * platform's broker (`POST /api/broker/deploy-status`) which calls
 * Vercel/Netlify directly. Real signal — no time-based dead reckoning for
 * the *transitions* (the visible bar fill within the building state is
 * still time-based; neither provider exposes granular progress).
 */
/**
 * `in_flight` collapses the provider-reported queued/initializing/
 * building/finalizing into one state that carries the current phase
 * for label + progress purposes. The two pre-build phases
 * (`queued`, `initializing`) are intentionally surfaced as
 * "Building…" — they're <10s each and the distinction adds noise.
 * `finalizing` surfaces distinctly because it means "almost done."
 */
type PublishState =
  | { status: "idle" }
  | { status: "publishing" }
  // "saved" replaces the v1 immediate-publish path post-ADR-010 PR 3:
  // the editor's onPublish commits to draft, not main, and no deploy
  // fires. The in_flight / live / stalled states below are unused
  // for this flow but kept for back-compat in case the deploy
  // polling resurfaces in a follow-up.
  | { status: "saved" }
  | { status: "in_flight"; phase: DeployState; publishedAt: number }
  | { status: "live" }
  | { status: "stalled"; publishedAt: number }
  | { status: "error"; message: string };

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 90_000;

// Expected end-to-end build time (roughly the median observed for a
// Next.js musician-site template on Vercel/Netlify). Used for the
// progress bar fill animation while in the "building" state. Asymptote
// at 95% — we only claim "Live" when the provider says ready.
const EXPECTED_BUILD_MS = 60_000;

type DeployStatusBody = {
  ok: true;
  deploy: {
    id: string | null;
    state: DeployState;
    url: string | null;
    errorMessage?: string | null;
    createdAt: string | null;
  };
};

export function Editor({ initialData, pageSlug, email }: Props) {
  const [publishState, setPublishState] = useState<PublishState>({ status: "idle" });
  // Puck doesn't surface dirty state to wrappers; track it ourselves
  // via onChange. Reset on successful publish (the saved data becomes
  // the new baseline).
  const [isDirty, setIsDirty] = useState(false);
  useBeforeUnloadIfDirty(isDirty);

  const onPublish = useCallback(
    async (data: PageData) => {
      setPublishState({ status: "publishing" });
      try {
        const res = await fetch("/api/publish", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ pageSlug, data }),
        });
        const body = (await res.json().catch(() => null)) as
          | { ok: true; commitSha: string | null }
          | { ok: false; error?: string }
          | null;
        if (!res.ok) {
          const message =
            (body && "error" in body && body.error) ||
            `Publish failed (HTTP ${res.status})`;
          setPublishState({ status: "error", message });
          throw new Error(message);
        }
        // Post-ADR-010 PR 3: /api/publish saves to the draft branch
        // without triggering a deploy. The artist explicitly hits
        // Publish (in the AdminShell) to promote draft → main, which
        // is when the deploy fires. No polling here — there's no
        // deploy in flight from this save. Indicate "Saved" via the
        // pill regardless of dev vs prod (both paths persisted the
        // change; only the storage layer differs).
        setPublishState({ status: "saved" });
        setIsDirty(false);
      } catch (cause) {
        setPublishState((current) =>
          current.status === "error"
            ? current
            : {
                status: "error",
                message: cause instanceof Error ? cause.message : "Publish failed",
              },
        );
      }
    },
    [pageSlug],
  );

  // While we're waiting on a deploy (queued or building), poll the
  // platform's broker via /api/publish-status for real provider state.
  // Stale-deploy guard: ignore any deploy whose createdAt predates the
  // moment we hit publish, since that's a build kicked off by something
  // earlier (or another author) and isn't the one we care about.
  useEffect(() => {
    if (publishState.status !== "in_flight") return;
    const publishedAt = publishState.publishedAt;
    let cancelled = false;
    const start = Date.now();

    async function tick(): Promise<boolean> {
      try {
        const res = await fetch("/api/publish-status", { cache: "no-store" });
        if (!res.ok) return false;
        const body = (await res.json()) as DeployStatusBody | { ok: false };
        if (!("deploy" in body)) return false;
        const { deploy } = body;
        if (cancelled) return true;

        const deployTime = deploy.createdAt ? Date.parse(deploy.createdAt) : 0;
        // Allow a 30s grace window — Vercel sometimes records createdAt
        // slightly before our publish (clock skew, queue ordering).
        const isOurs = !deploy.createdAt || deployTime >= publishedAt - 30_000;

        if (deploy.state === "ready" && isOurs) {
          setPublishState({ status: "live" });
          return true;
        }
        if (deploy.state === "error" && isOurs) {
          setPublishState({
            status: "error",
            message: deploy.errorMessage ?? "Build failed on the deploy provider",
          });
          return true;
        }
        // Provider gave us a fresh in-flight phase — reflect it in the
        // pill (label + progress). queued / initializing / building /
        // finalizing all flow through here.
        if (
          (deploy.state === "queued" ||
            deploy.state === "initializing" ||
            deploy.state === "building" ||
            deploy.state === "finalizing") &&
          isOurs
        ) {
          const newPhase = deploy.state;
          setPublishState((current) =>
            current.status === "in_flight" && current.phase === newPhase
              ? current
              : { status: "in_flight", phase: newPhase, publishedAt },
          );
        }
        // unknown / pre-publish deploys: keep polling.
        return false;
      } catch {
        return false; // transient — try again next tick
      }
    }

    const interval = setInterval(async () => {
      if (cancelled) {
        clearInterval(interval);
        return;
      }
      if (await tick()) {
        clearInterval(interval);
        return;
      }
      if (Date.now() - start > POLL_TIMEOUT_MS) {
        clearInterval(interval);
        if (!cancelled) {
          setPublishState((current) =>
            current.status === "in_flight" ? { status: "stalled", publishedAt } : current,
          );
        }
      }
    }, POLL_INTERVAL_MS);

    // First check immediately so a fast deploy doesn't wait for the first
    // interval tick before we discover it.
    void tick();

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [publishState]);

  return (
    <Puck
      config={puckConfig}
      data={initialData}
      onPublish={onPublish}
      onChange={() => setIsDirty(true)}
      overrides={{
        headerActions: ({ children }) => (
          <>
            <Link
              href="/admin/pages"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "var(--space-1)",
                padding: "var(--space-1) var(--space-3)",
                fontSize: "var(--font-size-xs)",
                fontWeight: "var(--font-weight-semibold)" as unknown as number,
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--color-border)",
                background: "var(--color-surface)",
                color: "var(--color-text)",
                textDecoration: "none",
              }}
              title="Back to pages list"
            >
              ← Pages
            </Link>
            <span
              style={{
                fontSize: "var(--font-size-xs)",
                color: "var(--color-text-muted)",
                fontFamily: "var(--font-mono)",
              }}
              title="Page slug"
            >
              /{pageSlug}
            </span>
            <PublishStatusPill state={publishState} />
            {children}
            <AdminAccountButton email={email} />
          </>
        ),
      }}
    />
  );
}

function PublishStatusPill({ state }: { state: PublishState }) {
  const base = {
    display: "inline-flex" as const,
    alignItems: "center",
    gap: "var(--space-1)",
    padding: "var(--space-1) var(--space-2)",
    fontSize: "var(--font-size-xs)",
    fontWeight: "var(--font-weight-semibold)" as unknown as number,
    borderRadius: "var(--radius-sm)",
    whiteSpace: "nowrap" as const,
  };

  switch (state.status) {
    case "idle":
      return null;
    case "publishing":
      return (
        <span
          role="status"
          style={{
            ...base,
            background: "var(--color-surface-raised)",
            color: "var(--color-text-muted)",
          }}
        >
          <Spinner /> Publishing…
        </span>
      );
    case "in_flight": {
      // queued / initializing / building all render as "Building" — the
      // pre-build phases are brief and the distinction adds noise. Only
      // `finalizing` gets its own label (it means almost-done).
      const isFinalizing = state.phase === "finalizing";
      return (
        <span
          role="status"
          style={{
            ...base,
            background: "var(--color-surface-raised)",
            color: "var(--color-text-muted)",
          }}
          title={`Phase: ${state.phase} (~${EXPECTED_BUILD_MS / 1000}s typical end-to-end)`}
        >
          {isFinalizing ? "Finalizing…" : "Building…"} <ProgressBar phase={state.phase} />
        </span>
      );
    }
    case "saved":
      return (
        <span
          role="status"
          style={{
            ...base,
            background: "var(--color-surface-raised)",
            color: "var(--color-text)",
          }}
          title="Saved to draft. Hit Publish in the sidebar to push live."
        >
          <Dot /> Saved
        </span>
      );
    case "live":
      return (
        <span
          role="status"
          style={{
            ...base,
            background: "var(--color-surface-raised)",
            color: "var(--color-text)",
          }}
        >
          <Dot /> Live
        </span>
      );
    case "stalled":
      return (
        <span
          role="status"
          style={{
            ...base,
            background: "var(--color-surface-raised)",
            color: "var(--color-text-muted)",
          }}
          title="Build still running — refresh to check status"
        >
          Still building…
        </span>
      );
    case "error":
      return (
        <span
          role="alert"
          style={{
            ...base,
            background: "var(--color-surface-raised)",
            color: "var(--color-text-error)",
          }}
          title={state.message}
        >
          Publish failed
        </span>
      );
  }
}

/**
 * Stage-baseline progress for each phase. Mirrors the dashboard's
 * STAGE_PROGRESS in apps/web/src/app/sites/[siteId]/page.tsx — kept in
 * sync by hand because the artist site can't import from `apps/web`
 * (different package boundary).
 */
const STAGE_PROGRESS: Record<DeployState, number> = {
  queued: 0.15,
  initializing: 0.25,
  building: 0.45,
  finalizing: 0.90,
  ready: 1.0,
  error: 0,
  unknown: 0.10,
};

function ProgressBar({ phase }: { phase: DeployState }) {
  // Stage-driven width. CSS transition smooths the visual jump when
  // the provider reports a new phase (e.g. building 45% → finalizing
  // 90%). `width:` (not `transform: scaleX`) so the bar tracks an
  // absolute percentage of the container — the parent pill is
  // narrow so a small JS update doesn't trigger noticeable layout.
  const pct = (STAGE_PROGRESS[phase] ?? 0.1) * 100;
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        width: "3rem",
        height: "0.25rem",
        background: "var(--color-border)",
        borderRadius: "var(--radius-sm)",
        overflow: "hidden",
        verticalAlign: "middle",
      }}
    >
      <span
        style={{
          display: "block",
          width: `${pct}%`,
          height: "100%",
          background: "var(--color-text-muted)",
          transition: "width 600ms ease",
        }}
      />
    </span>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        width: "0.625rem",
        height: "0.625rem",
        border: "2px solid var(--color-border-strong)",
        borderTopColor: "var(--color-text-muted)",
        borderRadius: "50%",
        animation: "stagecraftSpin 0.8s linear infinite",
      }}
    />
  );
}

function Dot() {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        width: "0.5rem",
        height: "0.5rem",
        borderRadius: "50%",
        background: "var(--color-action)",
      }}
    />
  );
}

