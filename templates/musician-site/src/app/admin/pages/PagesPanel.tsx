"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { TextField } from "@/components/admin/form";
import { PAGES_FIELD_IDS } from "@/lib/collections/field-ids";
import {
  PAGE_SLUG_PATTERN,
  reorderPagesBefore,
  slugifyTitle,
  type PageSummary,
} from "@/lib/site-config-types";

type Props = {
  initialPages: PageSummary[];
};

/**
 * Client island for the Pages panel.
 *
 * What lives here that didn't before:
 *   - Drag-reorder per row — order persists to the pages collection's
 *     `_order.json` and drives the public nav order.
 *   - Eye toggle per row — flips the page item's `showInNav` field.
 *     Splash pages don't get a toggle (they override "/" and shouldn't
 *     appear in the nav anyway).
 *
 * Mutations:
 *   - Reorder → `PUT /api/collections/pages/order` with the new slug
 *     array.
 *   - Toggle → `GET /api/collections/pages/items/<slug>` to pick up the
 *     current field values, flip `showInNav`, then
 *     `PUT /api/collections/pages/items/<slug>` to write back. The
 *     fetch-then-PUT pattern (vs. a server-side PATCH) keeps the
 *     collection API surface narrow — the generic PUT validates the
 *     whole item against the dynamic Zod schema either way.
 *
 * Both endpoints live under `/api/collections/<slug>/...` — same
 * surface the generic editor uses. The legacy `/api/save-config`
 * endpoint is gone.
 *
 * Add-page no longer auto-jumps to the editor — it stays on this list
 * so the artist can keep arranging order/visibility before opening
 * Puck. Each row's "Edit" button is the deliberate path into the
 * editor.
 */
export function PagesPanel({ initialPages }: Props) {
  const router = useRouter();

  const [pages, setPages] = useState(initialPages);
  const [newTitle, setNewTitle] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [hasSlugBeenEdited, setHasSlugBeenEdited] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [deletingSlug, setDeletingSlug] = useState<string | null>(null);
  const [navError, setNavError] = useState<string | null>(null);
  const [draggingSlug, setDraggingSlug] = useState<string | null>(null);
  const [dragOverSlug, setDragOverSlug] = useState<string | null>(null);
  const [renamingPage, setRenamingPage] = useState<PageSummary | null>(null);

  const effectiveSlug = hasSlugBeenEdited ? newSlug : slugifyTitle(newTitle);
  const isSlugValid = effectiveSlug.length > 0 && PAGE_SLUG_PATTERN.test(effectiveSlug);
  const isTitleValid = newTitle.trim().length > 0;
  const canCreate = isSlugValid && isTitleValid && !isCreating;

  async function savePageOrder(order: string[]): Promise<boolean> {
    setNavError(null);
    try {
      const res = await fetch("/api/collections/pages/order", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ order }),
      });
      const body = (await res.json().catch(() => null)) as
        | { ok: true }
        | { ok: false; error: string }
        | null;
      if (!res.ok || !body || !body.ok) {
        setNavError(
          (body && "error" in body && body.error) || `Save failed (HTTP ${res.status})`,
        );
        return false;
      }
      return true;
    } catch (cause) {
      setNavError(cause instanceof Error ? cause.message : "Save failed");
      return false;
    }
  }

  /**
   * Flip a single page's `showInNav` field. Fetches the current item
   * (we don't have it in the panel's PageSummary view), flips the
   * boolean, and PUTs the merged values back. One commit per toggle.
   *
   * Concurrency: last-write-wins. No `If-Match` / ETag — if two tabs
   * toggle the same page near-simultaneously the second PUT
   * overwrites the first. Fine for the single-user admin UX; if the
   * platform ever goes multi-tab / multi-admin, the per-item PUT
   * needs versioning.
   *
   * Round-trips: this is GET + PUT (two requests) per toggle.
   * Acceptable today; if bulk affordances ("hide all" / "show all")
   * land, revisit with a server-side PATCH that merges partial
   * values to halve the request count.
   */
  async function setPageShowInNav(slug: string, showInNav: boolean): Promise<boolean> {
    setNavError(null);
    try {
      const getRes = await fetch(
        `/api/collections/pages/items/${encodeURIComponent(slug)}`,
      );
      const getBody = (await getRes.json().catch(() => null)) as
        | { ok: true; item: { values: Record<string, unknown> } }
        | { ok: false; error: string }
        | null;
      if (!getRes.ok || !getBody || !getBody.ok) {
        setNavError(
          (getBody && "error" in getBody && getBody.error) ||
            `Load failed (HTTP ${getRes.status})`,
        );
        return false;
      }
      const nextValues = {
        ...getBody.item.values,
        [PAGES_FIELD_IDS.showInNav]: { type: "boolean", value: showInNav },
      };
      const putRes = await fetch(
        `/api/collections/pages/items/${encodeURIComponent(slug)}`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ values: nextValues }),
        },
      );
      const putBody = (await putRes.json().catch(() => null)) as
        | { ok: true }
        | { ok: false; error: string }
        | null;
      if (!putRes.ok || !putBody || !putBody.ok) {
        setNavError(
          (putBody && "error" in putBody && putBody.error) ||
            `Save failed (HTTP ${putRes.status})`,
        );
        return false;
      }
      return true;
    } catch (cause) {
      setNavError(cause instanceof Error ? cause.message : "Save failed");
      return false;
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);
    if (!canCreate) return;
    setIsCreating(true);
    try {
      const res = await fetch("/api/pages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug: effectiveSlug, title: newTitle.trim() }),
      });
      const body = (await res.json().catch(() => null)) as
        | { ok: true; slug: string }
        | { ok: false; error: string }
        | null;
      if (!res.ok || !body || !body.ok) {
        setCreateError(
          (body && "error" in body && body.error) || `Create failed (HTTP ${res.status})`,
        );
        return;
      }
      setPages((current) => [
        ...current,
        {
          slug: body.slug,
          title: newTitle.trim(),
          isSplashPage: false,
          isHiddenFromNav: false,
        },
      ]);
      setNewTitle("");
      setNewSlug("");
      setHasSlugBeenEdited(false);
      router.refresh();
    } catch (cause) {
      setCreateError(cause instanceof Error ? cause.message : "Create failed");
    } finally {
      setIsCreating(false);
    }
  }

  async function handleDelete(slug: string) {
    if (!window.confirm(`Delete page "${slug}"? This cannot be undone.`)) return;
    setDeletingSlug(slug);
    try {
      const res = await fetch(`/api/pages/${encodeURIComponent(slug)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        window.alert(body?.error ?? `Delete failed (HTTP ${res.status})`);
        return;
      }
      setPages((current) => current.filter((p) => p.slug !== slug));
      // TODO: prune the deleted slug from `_order.json` here.
      // `listItemsInOrder` filters missing items at read time, so a
      // phantom entry is benign, but they accumulate over time. A PUT
      // to /api/collections/pages/order with the freshly-filtered
      // order array would tidy up.
      router.refresh();
    } finally {
      setDeletingSlug(null);
    }
  }

  async function toggleHiddenFromNav(slug: string) {
    const target = pages.find((p) => p.slug === slug);
    if (!target) return;
    const wasHidden = target.isHiddenFromNav;
    // Optimistic UI: flip the row first, revert if the save fails.
    setPages((current) =>
      current.map((p) =>
        p.slug === slug ? { ...p, isHiddenFromNav: !wasHidden } : p,
      ),
    );
    const ok = await setPageShowInNav(slug, wasHidden /* invert: was hidden → showInNav=true */);
    if (!ok) {
      setPages((current) =>
        current.map((p) => (p.slug === slug ? { ...p, isHiddenFromNav: wasHidden } : p)),
      );
    }
  }

  async function handleRename(oldSlug: string, nextSlug: string): Promise<string | null> {
    try {
      const res = await fetch(
        `/api/collections/pages/items/${encodeURIComponent(oldSlug)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ newSlug: nextSlug }),
        },
      );
      const body = (await res.json().catch(() => null)) as
        | { ok: true; newSlug: string }
        | { ok: false; error: string }
        | null;
      if (!res.ok || !body || !body.ok) {
        return (body && "error" in body && body.error) || `Rename failed (HTTP ${res.status})`;
      }
      // Optimistic local update: swap the slug everywhere the panel
      // holds it. router.refresh() pulls the canonical state.
      setPages((current) =>
        current.map((p) => (p.slug === oldSlug ? { ...p, slug: body.newSlug } : p)),
      );
      setSiteConfig((prev) => ({
        ...prev,
        pageOrder: prev.pageOrder.map((s) => (s === oldSlug ? body.newSlug : s)),
        hiddenFromNav: prev.hiddenFromNav.map((s) => (s === oldSlug ? body.newSlug : s)),
      }));
      router.refresh();
      return null;
    } catch (cause) {
      return cause instanceof Error ? cause.message : "Rename failed";
    }
  }

  async function reorderTo(draggedSlug: string, targetSlug: string) {
    if (draggedSlug === targetSlug) return;
    const reordered = reorderPagesBefore(pages, draggedSlug, targetSlug);
    const previousPages = pages;
    setPages(reordered);
    const ok = await savePageOrder(reordered.map((p) => p.slug));
    if (!ok) {
      setPages(previousPages);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
      <section
        aria-label="Page list"
        style={{
          background: "var(--color-surface)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius)",
          overflow: "hidden",
        }}
      >
        {pages.length === 0 ? (
          <p
            style={{
              padding: "var(--space-6)",
              color: "var(--color-text-muted)",
              margin: 0,
            }}
          >
            No pages yet — add one below to get started.
          </p>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {pages.map((page, idx) => {
              const isDragOver = dragOverSlug === page.slug && draggingSlug !== page.slug;
              return (
                <li
                  key={page.slug}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", page.slug);
                    setDraggingSlug(page.slug);
                  }}
                  onDragEnd={() => {
                    setDraggingSlug(null);
                    setDragOverSlug(null);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    if (draggingSlug && draggingSlug !== page.slug) {
                      setDragOverSlug(page.slug);
                    }
                  }}
                  onDragLeave={() => {
                    if (dragOverSlug === page.slug) setDragOverSlug(null);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const slug = e.dataTransfer.getData("text/plain");
                    setDragOverSlug(null);
                    if (slug) void reorderTo(slug, page.slug);
                  }}
                  aria-label={`${page.title}, slug ${page.slug}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--space-3)",
                    padding: "var(--space-3) var(--space-4)",
                    borderTop: idx === 0 ? "none" : "1px solid var(--color-border)",
                    background: isDragOver
                      ? "var(--color-surface-raised)"
                      : "transparent",
                    opacity: draggingSlug === page.slug ? 0.4 : 1,
                    cursor: "default",
                  }}
                >
                  <span
                    aria-hidden="true"
                    title="Drag to reorder"
                    style={{
                      cursor: "grab",
                      color: "var(--color-text-muted)",
                      fontFamily: "var(--font-mono)",
                      fontSize: "var(--font-size-lg)",
                      userSelect: "none",
                      padding: "0 var(--space-1)",
                    }}
                  >
                    ⋮⋮
                  </span>
                  <Link
                    href={`/admin/pages/${page.slug}`}
                    style={{
                      flex: 1,
                      color: "var(--color-text)",
                      textDecoration: "none",
                      display: "flex",
                      flexDirection: "column",
                    }}
                  >
                    <span
                      style={{
                        fontSize: "var(--font-size-base)",
                        fontWeight: "var(--font-weight-semibold)" as unknown as number,
                      }}
                    >
                      {page.title}
                    </span>
                    <span
                      style={{
                        fontSize: "var(--font-size-xs)",
                        color: "var(--color-text-muted)",
                        fontFamily: "var(--font-mono)",
                      }}
                    >
                      {page.isSplashPage ? "/" : `/${page.slug}`}
                    </span>
                  </Link>
                  {page.isSplashPage ? (
                    <span
                      title="Splash page — takes over /"
                      style={{
                        fontSize: "var(--font-size-xs)",
                        color: "var(--color-text-emphasis)",
                        padding: "var(--space-1) var(--space-2)",
                        background: "var(--color-surface-raised)",
                        borderRadius: "var(--radius-sm)",
                      }}
                    >
                      Splash
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => toggleHiddenFromNav(page.slug)}
                      aria-label={
                        page.isHiddenFromNav
                          ? `Show ${page.title} in the navigation menu`
                          : `Hide ${page.title} from the navigation menu`
                      }
                      aria-pressed={page.isHiddenFromNav}
                      title={
                        page.isHiddenFromNav
                          ? "Hidden from nav — click to show"
                          : "Visible in nav — click to hide"
                      }
                      style={{
                        padding: "var(--space-1) var(--space-2)",
                        border: "1px solid var(--color-border)",
                        background: page.isHiddenFromNav
                          ? "var(--color-surface)"
                          : "var(--color-surface-raised)",
                        color: page.isHiddenFromNav
                          ? "var(--color-text-muted)"
                          : "var(--color-text)",
                        cursor: "pointer",
                        borderRadius: "var(--radius-sm)",
                        display: "inline-flex",
                        alignItems: "center",
                      }}
                    >
                      {page.isHiddenFromNav ? <EyeOffIcon /> : <EyeIcon />}
                    </button>
                  )}
                  <Link
                    href={`/admin/pages/${page.slug}`}
                    style={{
                      padding: "var(--space-1) var(--space-3)",
                      fontSize: "var(--font-size-sm)",
                      border: "1px solid var(--color-border)",
                      background: "var(--color-surface)",
                      color: "var(--color-text)",
                      cursor: "pointer",
                      borderRadius: "var(--radius-sm)",
                      textDecoration: "none",
                    }}
                  >
                    Edit
                  </Link>
                  <button
                    type="button"
                    onClick={() => setRenamingPage(page)}
                    aria-label={`Rename page ${page.slug}`}
                    style={{
                      padding: "var(--space-1) var(--space-3)",
                      fontSize: "var(--font-size-sm)",
                      border: "1px solid var(--color-border)",
                      background: "var(--color-surface)",
                      color: "var(--color-text)",
                      cursor: "pointer",
                      borderRadius: "var(--radius-sm)",
                    }}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(page.slug)}
                    disabled={deletingSlug === page.slug}
                    aria-label={`Delete page ${page.slug}`}
                    style={{
                      padding: "var(--space-1) var(--space-3)",
                      fontSize: "var(--font-size-sm)",
                      border: "1px solid var(--color-border)",
                      background: "var(--color-surface)",
                      color: "var(--color-text-error)",
                      cursor: deletingSlug === page.slug ? "wait" : "pointer",
                      borderRadius: "var(--radius-sm)",
                    }}
                  >
                    {deletingSlug === page.slug ? "Deleting…" : "Delete"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {navError ? (
        <div
          role="alert"
          style={{
            color: "var(--color-text-error)",
            fontSize: "var(--font-size-sm)",
          }}
        >
          {navError}
        </div>
      ) : null}

      <section
        aria-label="Add a page"
        style={{
          background: "var(--color-surface)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius)",
          padding: "var(--space-6)",
        }}
      >
        <h2
          style={{
            fontSize: "var(--font-size-lg)",
            fontWeight: "var(--font-weight-semibold)" as unknown as number,
            margin: "0 0 var(--space-4) 0",
          }}
        >
          Add a page
        </h2>
        <form onSubmit={handleCreate}>
          <TextField
            id="new-page-title"
            label="Title"
            description="Shown on the page itself and in the browser tab."
            value={newTitle}
            onChange={setNewTitle}
            placeholder="e.g. Tour 2026"
            isRequired
          />
          <TextField
            id="new-page-slug"
            label="URL slug"
            description={
              <>
                Lowercase letters, digits, and hyphens. Becomes the URL (
                <code style={{ fontFamily: "var(--font-mono)" }}>/{effectiveSlug || "your-slug"}</code>).
                {hasSlugBeenEdited ? null : " Suggested from the title — edit to override."}
              </>
            }
            value={effectiveSlug}
            onChange={(v) => {
              setHasSlugBeenEdited(true);
              setNewSlug(v);
            }}
            placeholder="tour-2026"
            isRequired
          />
          {createError ? (
            <div
              role="alert"
              style={{
                color: "var(--color-text-error)",
                fontSize: "var(--font-size-sm)",
                marginBottom: "var(--space-4)",
              }}
            >
              {createError}
            </div>
          ) : null}
          <button
            type="submit"
            disabled={!canCreate}
            style={{
              padding: "var(--space-2) var(--space-4)",
              fontSize: "var(--font-size-sm)",
              fontWeight: "var(--font-weight-semibold)" as unknown as number,
              border: "1px solid transparent",
              background: canCreate ? "var(--color-action)" : "var(--color-action-disabled)",
              color: "var(--color-action-fg)",
              cursor: canCreate ? "pointer" : "not-allowed",
              borderRadius: "var(--radius-sm)",
            }}
          >
            {isCreating ? "Creating…" : "Add page"}
          </button>
        </form>
      </section>

      {renamingPage ? (
        <RenamePageModal
          page={renamingPage}
          onCancel={() => setRenamingPage(null)}
          onSubmit={async (nextSlug) => {
            const error = await handleRename(renamingPage.slug, nextSlug);
            if (error === null) setRenamingPage(null);
            return error;
          }}
        />
      ) : null}
    </div>
  );
}

function RenamePageModal({
  page,
  onCancel,
  onSubmit,
}: {
  page: PageSummary;
  onCancel: () => void;
  onSubmit: (nextSlug: string) => Promise<string | null>;
}) {
  const [nextSlug, setNextSlug] = useState(page.slug);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Remember the element that had focus before the modal opened so we
  // can restore it on close. Without this, keyboard / screen-reader
  // users land in the page chrome instead of back on the Rename
  // button they triggered the modal from.
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    triggerRef.current = document.activeElement as HTMLElement | null;
    // Auto-focus the slug input on mount so the artist can start
    // typing immediately.
    inputRef.current?.focus();
    inputRef.current?.select();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !isSaving) onCancel();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      triggerRef.current?.focus?.();
    };
    // We deliberately don't re-run on every render — the focus
    // restore should fire once at unmount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isValid =
    nextSlug.length > 0 && PAGE_SLUG_PATTERN.test(nextSlug) && nextSlug !== page.slug;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid || isSaving) return;
    setIsSaving(true);
    const msg = await onSubmit(nextSlug);
    setIsSaving(false);
    if (msg !== null) setError(msg);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="rename-modal-title"
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
      }}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--color-surface)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius)",
          padding: "var(--space-6)",
          width: "min(28rem, calc(100% - var(--space-8)))",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-4)",
        }}
      >
        <h2
          id="rename-modal-title"
          style={{
            margin: 0,
            fontSize: "var(--font-size-lg)",
            fontWeight: "var(--font-weight-semibold)" as unknown as number,
          }}
        >
          Rename page
        </h2>
        {page.isSplashPage ? (
          // Splash pages always render at `/`, regardless of slug.
          // Renaming changes the filename and the URL the page would
          // have if it stopped being the splash, but doesn't break
          // any currently-live link.
          <p
            style={{
              margin: 0,
              fontSize: "var(--font-size-sm)",
              color: "var(--color-text-muted)",
            }}
          >
            This is the splash page, so it always lives at{" "}
            <code style={{ fontFamily: "var(--font-mono)" }}>/</code> — renaming
            won&apos;t change its public URL. The filename and the slug it would
            have if it stopped being the splash change from{" "}
            <code style={{ fontFamily: "var(--font-mono)" }}>{page.slug}</code> to{" "}
            <code style={{ fontFamily: "var(--font-mono)" }}>
              {nextSlug || "new-slug"}
            </code>
            .
          </p>
        ) : (
          <p
            style={{
              margin: 0,
              fontSize: "var(--font-size-sm)",
              color: "var(--color-text-muted)",
            }}
          >
            Renaming changes the page&apos;s URL from{" "}
            <code style={{ fontFamily: "var(--font-mono)" }}>/{page.slug}</code> to{" "}
            <code style={{ fontFamily: "var(--font-mono)" }}>
              /{nextSlug || "new-slug"}
            </code>
            . The old URL won&apos;t redirect — anyone with a link to{" "}
            <code style={{ fontFamily: "var(--font-mono)" }}>/{page.slug}</code> will see
            a 404. Copy the old URL first if you need to update external links.
          </p>
        )}
        <TextField
          id="rename-page-slug"
          label="New URL slug"
          description="Lowercase letters, digits, and hyphens."
          value={nextSlug}
          onChange={(v) => {
            setError(null);
            setNextSlug(v);
          }}
          placeholder="e.g. tour-2026"
          isRequired
          inputRef={inputRef}
        />
        {error ? (
          <div
            role="alert"
            style={{
              color: "var(--color-text-error)",
              fontSize: "var(--font-size-sm)",
            }}
          >
            {error}
          </div>
        ) : null}
        <div
          style={{
            display: "flex",
            gap: "var(--space-2)",
            justifyContent: "flex-end",
          }}
        >
          <button
            type="button"
            onClick={onCancel}
            disabled={isSaving}
            style={{
              padding: "var(--space-2) var(--space-4)",
              fontSize: "var(--font-size-sm)",
              border: "1px solid var(--color-border)",
              background: "var(--color-surface)",
              color: "var(--color-text)",
              cursor: isSaving ? "wait" : "pointer",
              borderRadius: "var(--radius-sm)",
            }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!isValid || isSaving}
            style={{
              padding: "var(--space-2) var(--space-4)",
              fontSize: "var(--font-size-sm)",
              fontWeight: "var(--font-weight-semibold)" as unknown as number,
              border: "1px solid transparent",
              background:
                isValid && !isSaving
                  ? "var(--color-action)"
                  : "var(--color-action-disabled)",
              color: "var(--color-action-fg)",
              cursor: isValid && !isSaving ? "pointer" : "not-allowed",
              borderRadius: "var(--radius-sm)",
            }}
          >
            {isSaving ? "Renaming…" : "Rename"}
          </button>
        </div>
      </form>
    </div>
  );
}

function EyeIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}
