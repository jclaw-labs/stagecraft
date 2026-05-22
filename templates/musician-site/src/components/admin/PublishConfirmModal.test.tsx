// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PublishConfirmModal } from "./PublishConfirmModal";

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

  it("calls onConfirm when Publish is clicked", async () => {
    const onConfirm = vi.fn();
    fetchMock.mockResolvedValue(
      jsonResponse({ ok: true, status: { count: 0, changes: [], mode: "github" } }),
    );
    render(
      <PublishConfirmModal onCancel={() => {}} onConfirm={onConfirm} isPublishing={false} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Publish" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
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
});
