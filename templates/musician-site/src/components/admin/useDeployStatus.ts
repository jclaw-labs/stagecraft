/**
 * Hook: poll the platform's deploy-status endpoint after a publish
 * lands. Returns the current deploy state, transitioning through
 * `queued` / `initializing` / `building` / `finalizing` (collapsed
 * for label purposes) to `ready` or `error`.
 *
 * Why a hook: ADR-010 PR 3 split save and publish into separate
 * actions. The page editor's onPublish now just saves to draft (no
 * deploy); only the sidebar Publish button triggers a deploy. The
 * polling logic that used to live in `Editor.tsx` belongs here so
 * any caller that fires a publish can consume the deploy lifecycle
 * with one hook call.
 *
 * Usage:
 *
 * ```ts
 * const [publishedAt, setPublishedAt] = useState<number | null>(null);
 * const status = useDeployStatus(publishedAt);
 *
 * // when a publish lands:
 * setPublishedAt(Date.now());
 * ```
 *
 * `publishedAt: null` means "no deploy in flight" — the hook is a
 * no-op and returns `null`. When the caller sets a timestamp, the
 * hook starts polling. It returns the latest status until the deploy
 * reaches `ready` / `error` / `stalled` (then it stays there until
 * the caller sets `publishedAt` to a new value or `null`).
 *
 * The stale-deploy guard: a deploy whose `createdAt` predates the
 * supplied `publishedAt` by more than 30s is treated as not-ours
 * (kicked off by an earlier publish or another author) and ignored.
 * 30s tolerates Vercel clock skew + the broker → GitHub → webhook
 * → Vercel chain's natural latency.
 */

"use client";

import { useEffect, useState } from "react";

import type { DeployState } from "@/lib/deploy-status";

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 90_000;

export type DeployStatus =
  | { status: "in_flight"; phase: DeployState }
  | { status: "ready" }
  | { status: "stalled" }
  | { status: "error"; message: string };

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

/**
 * Polls `/api/publish-status` until the deploy resolves. Returns
 * `null` while `publishedAt` is `null` (no deploy in flight).
 */
export function useDeployStatus(publishedAt: number | null): DeployStatus | null {
  const [status, setStatus] = useState<DeployStatus | null>(null);

  useEffect(() => {
    if (publishedAt === null) {
      setStatus(null);
      return;
    }
    // Capture the non-null timestamp into a local so the closures
    // below get a definite value (the dep-array `publishedAt` is
    // typed as `number | null` even though we've narrowed by this
    // point).
    const startedAt = publishedAt;
    // Fresh trigger — reset to the initial "queued" state and start polling.
    setStatus({ status: "in_flight", phase: "queued" });
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
        // 30s grace for Vercel clock skew / queue ordering.
        const isOurs = !deploy.createdAt || deployTime >= startedAt - 30_000;

        if (deploy.state === "ready" && isOurs) {
          setStatus({ status: "ready" });
          return true;
        }
        if (deploy.state === "error" && isOurs) {
          setStatus({
            status: "error",
            message: deploy.errorMessage ?? "Build failed on the deploy provider",
          });
          return true;
        }
        if (
          (deploy.state === "queued" ||
            deploy.state === "initializing" ||
            deploy.state === "building" ||
            deploy.state === "finalizing") &&
          isOurs
        ) {
          const newPhase = deploy.state;
          setStatus((current) =>
            current?.status === "in_flight" && current.phase === newPhase
              ? current
              : { status: "in_flight", phase: newPhase },
          );
        }
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
          setStatus((current) =>
            current?.status === "in_flight" ? { status: "stalled" } : current,
          );
        }
      }
    }, POLL_INTERVAL_MS);

    // First check immediately so a fast deploy doesn't wait for the
    // initial 3s tick before being noticed.
    void tick();

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [publishedAt]);

  return status;
}

/**
 * Stage-baseline progress for each deploy phase. Mirrors the
 * dashboard's STAGE_PROGRESS in apps/web/src/app/sites/[siteId]/page.tsx
 * — kept in sync by hand because the artist site can't import from
 * `apps/web` (different package boundary).
 */
export const DEPLOY_STAGE_PROGRESS: Record<DeployState, number> = {
  queued: 0.15,
  initializing: 0.25,
  building: 0.45,
  finalizing: 0.9,
  ready: 1.0,
  error: 0,
  unknown: 0.1,
};
