// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PublishConfirmModal, groupChanges } from "./PublishConfirmModal";
import type { DraftChange } from "@/lib/draft-changes";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, init?: { status?: number }) {
  return {
    ok: (init?.status ?? 200) < 400,
    status: init?.status ?? 200,
    json: async () => body,
  };
}

const sampleChanges = [
  {
    kind: "item" as const,
    status: "modified" as const,
    collectionSlug: "pages",
    itemSlug: "about",
    path: "src/content/collections/pages/items/about.json",
  },
  {
    kind: "image" as const,
    status: "added" as const,
    contentSlug: "header",
    imageId: "abc123",
    path: "public/images/header/abc123/original.png",
  },
];

describe("PublishConfirmModal", () => {
  it("renders a loading message while the fetch is in flight", () => {
    fetchMock.mockReturnValue(new Promise(() => {})); // pending forever
    render(
      <PublishConfirmModal
        onCancel={() => {}}
        onConfirm={() => {}}
        isPublishing={false}
      />,
    );
    expect(screen.getByText("Loading the change list…")).toBeTruthy();
  });

  it("renders the rename source as 'previous → current' for renamed items", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        ok: true,
        status: {
          count: 1,
          changes: [
            {
              kind: "item" as const,
              status: "renamed" as const,
              collectionSlug: "pages",
              itemSlug: "about-us",
              path: "src/content/collections/pages/items/about-us.json",
              previousPath: "src/content/collections/pages/items/about.json",
              previousItemSlug: "about",
            },
          ],
          mode: "github",
        },
      }),
    );
    render(
      <PublishConfirmModal onCancel={() => {}} onConfirm={() => {}} isPublishing={false} />,
    );
    await waitFor(() => {
      expect(screen.getByText("pages · about → about-us")).toBeTruthy();
    });
  });

  it("renders the change list once the fetch resolves", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        ok: true,
        status: { count: 2, changes: sampleChanges, mode: "github" },
      }),
    );
    render(
      <PublishConfirmModal
        onCancel={() => {}}
        onConfirm={() => {}}
        isPublishing={false}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText("pages · about")).toBeTruthy();
    });
    expect(screen.getByText("Image · abc123")).toBeTruthy();
    // Status labels rendered as "modified" / "added" alongside.
    expect(screen.getByText("modified")).toBeTruthy();
    expect(screen.getByText("added")).toBeTruthy();
  });

  it("falls back to an error copy when the fetch returns !ok", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: false, error: "boom" }, { status: 500 }));
    render(
      <PublishConfirmModal
        onCancel={() => {}}
        onConfirm={() => {}}
        isPublishing={false}
      />,
    );
    await waitFor(() => {
      expect(
        screen.getByText(/Couldn['’]t load the change list/),
      ).toBeTruthy();
    });
  });

  it("shows 'Nothing to publish' when the changes list is empty", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ ok: true, status: { count: 0, changes: [], mode: "github" } }),
    );
    render(
      <PublishConfirmModal
        onCancel={() => {}}
        onConfirm={() => {}}
        isPublishing={false}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText("Nothing to publish.")).toBeTruthy();
    });
  });

  it("calls onCancel when Cancel is clicked", async () => {
    const onCancel = vi.fn();
    fetchMock.mockResolvedValue(
      jsonResponse({ ok: true, status: { count: 0, changes: [], mode: "github" } }),
    );
    render(
      <PublishConfirmModal onCancel={onCancel} onConfirm={() => {}} isPublishing={false} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("calls onConfirm with the (default) commit subject when Publish is clicked", async () => {
    const onConfirm = vi.fn();
    fetchMock.mockResolvedValue(
      jsonResponse({
        ok: true,
        status: { count: 2, changes: sampleChanges, mode: "github" },
      }),
    );
    render(
      <PublishConfirmModal onCancel={() => {}} onConfirm={onConfirm} isPublishing={false} />,
    );
    // Wait for the changes to load + the default subject to seed in.
    await waitFor(() => {
      const input = screen.getByLabelText("Commit message") as HTMLInputElement;
      expect(input.value).toBe("Publish 2 changes");
    });
    await userEvent.click(screen.getByRole("button", { name: "Publish" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith("Publish 2 changes");
  });

  it("seeds the singular default subject when count === 1", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        ok: true,
        status: { count: 1, changes: [sampleChanges[0]], mode: "github" },
      }),
    );
    render(
      <PublishConfirmModal onCancel={() => {}} onConfirm={() => {}} isPublishing={false} />,
    );
    await waitFor(() => {
      const input = screen.getByLabelText("Commit message") as HTMLInputElement;
      expect(input.value).toBe("Publish 1 change");
    });
  });

  it("emphasises the counter at >= 90% of the cap and red-flags it at the cap", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        ok: true,
        status: { count: 2, changes: sampleChanges, mode: "github" },
      }),
    );
    render(
      <PublishConfirmModal onCancel={() => {}} onConfirm={() => {}} isPublishing={false} />,
    );
    // Wait for the default subject to actually seed in (otherwise the
    // userEvent below would race the changes-load effect).
    await waitFor(() => {
      const input = screen.getByLabelText("Commit message") as HTMLInputElement;
      expect(input.value).toBe("Publish 2 changes");
    });
    const input = screen.getByLabelText("Commit message") as HTMLInputElement;

    // Default-muted at low length.
    await userEvent.clear(input);
    await userEvent.type(input, "short");
    expect(screen.getByText("5 / 200").style.color).toBe("var(--color-text-faint)");

    // Near-cap (180 ≥ 90% of 200) → emphasised. `paste` to avoid
    // simulating 180 individual keystrokes.
    await userEvent.clear(input);
    await userEvent.click(input);
    await userEvent.paste("x".repeat(180));
    expect(screen.getByText("180 / 200").style.color).toBe("var(--color-text-emphasis)");

    // At the cap (200 / 200) → error colour.
    await userEvent.clear(input);
    await userEvent.click(input);
    await userEvent.paste("x".repeat(200));
    expect(screen.getByText("200 / 200").style.color).toBe("var(--color-text-error)");
  });

  it("renders a character counter that tracks the input value", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        ok: true,
        status: { count: 2, changes: sampleChanges, mode: "github" },
      }),
    );
    render(
      <PublishConfirmModal onCancel={() => {}} onConfirm={() => {}} isPublishing={false} />,
    );
    // After the changes-list seeds the default "Publish 2 changes"
    // (17 chars), the counter should reflect that.
    await waitFor(() => {
      expect(screen.getByText("17 / 200")).toBeTruthy();
    });
    const input = screen.getByLabelText("Commit message") as HTMLInputElement;
    await userEvent.clear(input);
    await userEvent.type(input, "abc");
    expect(screen.getByText("3 / 200")).toBeTruthy();
  });

  it("passes the edited subject through onConfirm", async () => {
    const onConfirm = vi.fn();
    fetchMock.mockResolvedValue(
      jsonResponse({
        ok: true,
        status: { count: 2, changes: sampleChanges, mode: "github" },
      }),
    );
    render(
      <PublishConfirmModal onCancel={() => {}} onConfirm={onConfirm} isPublishing={false} />,
    );
    // Wait for the default to actually seed before interacting; otherwise
    // userEvent races the changes-load effect that overwrites the value.
    await waitFor(() => {
      const input = screen.getByLabelText("Commit message") as HTMLInputElement;
      expect(input.value).toBe("Publish 2 changes");
    });
    const input = screen.getByLabelText("Commit message") as HTMLInputElement;
    await userEvent.clear(input);
    await userEvent.type(input, "Ship the about-page rewrite");
    await userEvent.click(screen.getByRole("button", { name: "Publish" }));
    expect(onConfirm).toHaveBeenCalledWith("Ship the about-page rewrite");
  });

  it("passes null through onConfirm when the artist clears the field", async () => {
    // null → the button layer sends an empty body, and the route
    // falls back to its own "Publish pending changes" default.
    const onConfirm = vi.fn();
    fetchMock.mockResolvedValue(
      jsonResponse({
        ok: true,
        status: { count: 2, changes: sampleChanges, mode: "github" },
      }),
    );
    render(
      <PublishConfirmModal onCancel={() => {}} onConfirm={onConfirm} isPublishing={false} />,
    );
    await waitFor(() => {
      const input = screen.getByLabelText("Commit message") as HTMLInputElement;
      expect(input.value).toBe("Publish 2 changes");
    });
    await userEvent.clear(screen.getByLabelText("Commit message"));
    await userEvent.click(screen.getByRole("button", { name: "Publish" }));
    expect(onConfirm).toHaveBeenCalledWith(null);
  });

  it("doesn't overwrite an edited subject when the changes list later loads", async () => {
    // Slow-load case: artist types into the field before the
    // changes-list fetch resolves. The default subject should NOT
    // clobber what they typed.
    let resolveFetch: (value: unknown) => void = () => {};
    fetchMock.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );
    render(
      <PublishConfirmModal onCancel={() => {}} onConfirm={() => {}} isPublishing={false} />,
    );
    const input = screen.getByLabelText("Commit message") as HTMLInputElement;
    await userEvent.type(input, "my message");
    expect(input.value).toBe("my message");
    // Fetch resolves with the default subject's would-be count.
    resolveFetch(
      jsonResponse({
        ok: true,
        status: { count: 5, changes: [], mode: "github" },
      }),
    );
    // Give the effect a tick; the value should still be the typed one.
    await new Promise((r) => setTimeout(r, 0));
    expect(input.value).toBe("my message");
  });

  it("disables both buttons and shows 'Publishing…' while isPublishing=true", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ ok: true, status: { count: 0, changes: [], mode: "github" } }),
    );
    render(
      <PublishConfirmModal
        onCancel={() => {}}
        onConfirm={() => {}}
        isPublishing={true}
      />,
    );
    const cancelButton = screen.getByRole("button", { name: "Cancel" });
    const publishButton = screen.getByRole("button", { name: "Publishing…" });
    expect((cancelButton as HTMLButtonElement).disabled).toBe(true);
    expect((publishButton as HTMLButtonElement).disabled).toBe(true);
  });

  it("escape cancels when not publishing", async () => {
    const onCancel = vi.fn();
    fetchMock.mockResolvedValue(
      jsonResponse({ ok: true, status: { count: 0, changes: [], mode: "github" } }),
    );
    render(
      <PublishConfirmModal onCancel={onCancel} onConfirm={() => {}} isPublishing={false} />,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("escape does NOT cancel while isPublishing=true", async () => {
    const onCancel = vi.fn();
    fetchMock.mockResolvedValue(
      jsonResponse({ ok: true, status: { count: 0, changes: [], mode: "github" } }),
    );
    render(
      <PublishConfirmModal onCancel={onCancel} onConfirm={() => {}} isPublishing={true} />,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("focuses the Publish button on mount and restores focus on unmount", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ ok: true, status: { count: 0, changes: [], mode: "github" } }),
    );
    // Set up a "trigger" button outside the modal, focused before mount,
    // so we can assert focus restoration on close.
    const trigger = document.createElement("button");
    trigger.textContent = "Open";
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const { unmount } = render(
      <PublishConfirmModal onCancel={() => {}} onConfirm={() => {}} isPublishing={false} />,
    );
    // Modal focuses the Publish button on mount.
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Publish" }));

    unmount();
    // After close, focus returns to the trigger that opened the modal.
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it("clicking the backdrop cancels (when not publishing)", async () => {
    const onCancel = vi.fn();
    fetchMock.mockResolvedValue(
      jsonResponse({ ok: true, status: { count: 0, changes: [], mode: "github" } }),
    );
    const { container } = render(
      <PublishConfirmModal onCancel={onCancel} onConfirm={() => {}} isPublishing={false} />,
    );
    // Click on the dialog (backdrop) itself, not the inner modal.
    const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
    fireEvent.click(dialog);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("renders one group per collection with a count in the heading", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        ok: true,
        status: {
          count: 4,
          changes: [
            {
              kind: "item" as const,
              status: "modified" as const,
              collectionSlug: "pages",
              itemSlug: "about",
              path: "src/content/collections/pages/items/about.json",
            },
            {
              kind: "item" as const,
              status: "added" as const,
              collectionSlug: "pages",
              itemSlug: "contact",
              path: "src/content/collections/pages/items/contact.json",
            },
            {
              kind: "image" as const,
              status: "added" as const,
              contentSlug: "header",
              imageId: "abc123",
              path: "public/images/header/abc123/original.png",
            },
            {
              kind: "image" as const,
              status: "added" as const,
              contentSlug: "header",
              imageId: "def456",
              path: "public/images/header/def456/original.jpg",
            },
          ],
          mode: "github",
        },
      }),
    );
    render(
      <PublishConfirmModal onCancel={() => {}} onConfirm={() => {}} isPublishing={false} />,
    );
    await waitFor(() => {
      // "pages" appears before "header" in alphabetical order (h < p).
      expect(screen.getByRole("heading", { name: "header · 2" })).toBeTruthy();
      expect(screen.getByRole("heading", { name: "pages · 2" })).toBeTruthy();
    });
  });
});

describe("groupChanges", () => {
  it("buckets by collection slug for items / singletons / defs / orders", () => {
    const changes: DraftChange[] = [
      { kind: "item", status: "modified", collectionSlug: "pages", itemSlug: "a", path: "a" },
      { kind: "singleton", status: "modified", collectionSlug: "site", path: "b" },
      { kind: "def", status: "modified", collectionSlug: "tour-dates", path: "c" },
      { kind: "order", status: "modified", collectionSlug: "pages", path: "d" },
    ];
    const groups = groupChanges(changes);
    expect(groups.map((g) => g.heading)).toEqual(["pages", "site", "tour-dates"]);
    expect(groups.find((g) => g.heading === "pages")?.items).toHaveLength(2);
  });

  it("buckets images by contentSlug", () => {
    const changes: DraftChange[] = [
      { kind: "image", status: "added", contentSlug: "header", imageId: "a", path: "x" },
      { kind: "image", status: "added", contentSlug: "header", imageId: "b", path: "y" },
      { kind: "image", status: "added", contentSlug: "photos", imageId: "c", path: "z" },
    ];
    const groups = groupChanges(changes);
    expect(groups.map((g) => g.heading)).toEqual(["header", "photos"]);
  });

  it("groups kind=other under an 'Other' bucket, sorted last", () => {
    const changes: DraftChange[] = [
      { kind: "other", status: "modified", path: "package.json" },
      { kind: "item", status: "modified", collectionSlug: "zzz", itemSlug: "x", path: "p" },
      { kind: "item", status: "modified", collectionSlug: "aaa", itemSlug: "y", path: "q" },
    ];
    const groups = groupChanges(changes);
    expect(groups.map((g) => g.heading)).toEqual(["aaa", "zzz", "Other"]);
  });

  it("preserves the compare-API order of items within a group", () => {
    const changes: DraftChange[] = [
      { kind: "item", status: "modified", collectionSlug: "pages", itemSlug: "z", path: "p1" },
      { kind: "item", status: "modified", collectionSlug: "pages", itemSlug: "a", path: "p2" },
      { kind: "item", status: "modified", collectionSlug: "pages", itemSlug: "m", path: "p3" },
    ];
    const groups = groupChanges(changes);
    expect(groups[0].items.map((c) => (c.kind === "item" ? c.itemSlug : null))).toEqual([
      "z",
      "a",
      "m",
    ]);
  });
});
