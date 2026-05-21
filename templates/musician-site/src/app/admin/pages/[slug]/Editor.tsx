"use client";

import { Puck } from "@measured/puck";
import "@measured/puck/puck.css";
import Link from "next/link";
import { useCallback, useState } from "react";

import { AdminAccountButton } from "@/components/admin/AdminAccountButton";
import { useBeforeUnloadIfDirty } from "@/components/admin/useBeforeUnloadIfDirty";
import { puckConfig } from "@/puck/config";
import { DrawerItemPreview } from "@/puck/DrawerItemPreview";
import type { PageData } from "@/lib/content";

type Props = {
  initialData: PageData;
  pageSlug: string;
  email: string;
};

/**
 * Save lifecycle for the page editor (ADR-010 PR 3):
 *
 *   idle → publishing → saved
 *                    ↘ error(message)
 *
 * "publishing" = the /api/publish round-trip (broker → draft commit).
 * "saved"      = saved to the `draft` branch. The deploy doesn't
 *                fire from here; the artist hits "Publish changes" in
 *                the AdminShell to promote draft → main, at which
 *                point the deploy status surfaces in the sidebar
 *                button via `useDeployStatus`.
 *
 * No deploy polling on this path — the page editor's save is purely
 * to draft, and `useDeployStatus` lives in the sidebar Publish
 * button where the deploy actually fires.
 */
type PublishState =
  | { status: "idle" }
  | { status: "publishing" }
  | { status: "saved" }
  | { status: "error"; message: string };

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

  return (
    <Puck
      config={puckConfig}
      data={initialData}
      onPublish={onPublish}
      onChange={() => setIsDirty(true)}
      overrides={{
        drawerItem: ({ name, children }) => (
          <DrawerItemPreview name={name}>{children}</DrawerItemPreview>
        ),
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
          <Spinner /> Saving…
        </span>
      );
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
          Save failed
        </span>
      );
  }
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

