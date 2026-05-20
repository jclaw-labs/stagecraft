import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const {
  commitFilesMock,
  ensureBranchExistsMock,
  mergeBranchIntoMock,
  squashBranchIntoMock,
} = vi.hoisted(() => ({
  commitFilesMock: vi.fn(),
  ensureBranchExistsMock: vi.fn(),
  mergeBranchIntoMock: vi.fn(),
  squashBranchIntoMock: vi.fn(),
}));
vi.mock("./git-commit", () => ({
  commitFiles: commitFilesMock,
  ensureBranchExists: ensureBranchExistsMock,
  mergeBranchInto: mergeBranchIntoMock,
  squashBranchInto: squashBranchIntoMock,
}));

import {
  isPlatformConfigured,
  publish,
  publishDraftToMain,
  publishPage,
  PublishError,
  saveToDraft,
} from "./publish";
import { FIXTURE_TIMESTAMP, tourDatesDef } from "./collections/test-fixtures";

/** Spread into in-line item-file literals so tests don't repeat them. */
const TS = { createdAt: FIXTURE_TIMESTAMP, updatedAt: FIXTURE_TIMESTAMP };

const TEST_SLUG = "publish-test";

// Each worker writes to its own tmpdir (resolved via STAGECRAFT_CONTENT_DIR)
// so parallel test files can't clobber each other's site.json / page files
// — see the matching pattern in content.test.ts.
let TMP_CONTENT_DIR: string;
/** Where the pages collection writes a test page item (PR 3 layout). */
let TEST_FILE: string;

const ORIGINAL_ENV = { ...process.env };

beforeAll(async () => {
  TMP_CONTENT_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "stagecraft-publish-"));
  TEST_FILE = path.join(TMP_CONTENT_DIR, "collections/pages/items", `${TEST_SLUG}.json`);
});

afterAll(async () => {
  await fs.rm(TMP_CONTENT_DIR, { recursive: true, force: true });
});

beforeEach(() => {
  commitFilesMock.mockReset();
  ensureBranchExistsMock.mockReset().mockResolvedValue(undefined);
  // Default: auto-rebase is a no-op (`main` already an ancestor of
  // `draft`). Tests that exercise the merge / conflict paths override.
  mergeBranchIntoMock
    .mockReset()
    .mockResolvedValue({ kind: "already-included", reason: "ancestor" });
  // Default: squash returns a deterministic SHA so happy-path tests
  // can ignore the call shape. Tests that care about the SHA override
  // explicitly.
  squashBranchIntoMock
    .mockReset()
    .mockResolvedValue({ commitSha: "squash-sha", alreadyInSync: false });
  process.env = { ...ORIGINAL_ENV };
  delete process.env.STAGECRAFT_PLATFORM_URL;
  delete process.env.STAGECRAFT_SITE_ID;
  delete process.env.STAGECRAFT_BROKER_SECRET;
  process.env.STAGECRAFT_CONTENT_DIR = TMP_CONTENT_DIR;
});

afterEach(async () => {
  await fs.rm(TEST_FILE, { force: true });
});

function configurePlatform({
  ok = true,
  body = {
    ok: true,
    token: "ghs_token",
    expiresAt: "2099-01-01T00:00:00.000Z",
    repo: { owner: "artist", name: "site" },
  },
  status = 200,
}: { ok?: boolean; body?: unknown; status?: number } = {}) {
  process.env.STAGECRAFT_PLATFORM_URL = "https://platform.example.com";
  process.env.STAGECRAFT_SITE_ID = "site-123";
  process.env.STAGECRAFT_BROKER_SECRET = "broker-secret";
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok,
    status,
    statusText: ok ? "OK" : "ERR",
    json: () => Promise.resolve(body),
  }) as unknown as typeof fetch;
}

describe("isPlatformConfigured", () => {
  it("false when no env vars", () => {
    expect(isPlatformConfigured()).toBe(false);
  });

  it("true when all three are set", () => {
    process.env.STAGECRAFT_PLATFORM_URL = "x";
    process.env.STAGECRAFT_SITE_ID = "y";
    process.env.STAGECRAFT_BROKER_SECRET = "z";
    expect(isPlatformConfigured()).toBe(true);
  });

  it("false when any one is missing", () => {
    process.env.STAGECRAFT_PLATFORM_URL = "x";
    process.env.STAGECRAFT_SITE_ID = "y";
    expect(isPlatformConfigured()).toBe(false);
  });
});

describe("publishPage — dev fallback (no platform configured)", () => {
  it("writes the page as a collection item and returns mode=local", async () => {
    const result = await publishPage({
      pageSlug: TEST_SLUG,
      data: { content: [], root: { props: { title: "Test" } } },
      authorEmail: "a@e.com",
    });
    expect(result.mode).toBe("local");
    expect(result.commitSha).toBeNull();
    // On disk: pages collection's items dir, item file in the new shape.
    const written = JSON.parse(await fs.readFile(TEST_FILE, "utf-8"));
    expect(written.id).toMatch(/^item_/);
    expect(written.values).toBeDefined();
  });

  it("does not call commitFiles in dev fallback", async () => {
    await publishPage({
      pageSlug: TEST_SLUG,
      data: { content: [], root: { props: { title: "x" } } },
      authorEmail: "a@e.com",
    });
    expect(commitFilesMock).not.toHaveBeenCalled();
  });
});

describe("publishPage — broker + GitHub path", () => {
  it("commits the page to draft and does NOT publish to main (ADR-010 PR 3)", async () => {
    configurePlatform();
    commitFilesMock.mockResolvedValue("draft-commit-sha");

    const result = await publishPage({
      pageSlug: TEST_SLUG,
      data: { content: [], root: { props: { title: "world" } } },
      authorEmail: "artist@example.com",
      authorName: "Real Artist",
    });

    // Post-PR 3: publishPage is save-only. The reported SHA is the
    // draft commit. squashBranchInto is NOT called — the artist
    // promotes draft → main via the explicit Publish flow.
    expect(result).toEqual({
      mode: "github",
      commitSha: "draft-commit-sha",
    });
    expect(squashBranchIntoMock).not.toHaveBeenCalled();
    // The per-save commit goes to `draft` with [skip ci].
    expect(commitFilesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        token: "ghs_token",
        owner: "artist",
        repo: "site",
        branch: "draft",
        files: [
          expect.objectContaining({
            path: `src/content/collections/pages/items/${TEST_SLUG}.json`,
          }),
        ],
        author: { name: "Real Artist", email: "artist@example.com" },
      }),
    );
  });

  it("ensures the draft branch exists before committing to it", async () => {
    configurePlatform();
    commitFilesMock.mockResolvedValue("sha");
    await publishPage({
      pageSlug: TEST_SLUG,
      data: { content: [], root: { props: { title: "x" } } },
      authorEmail: "a@e.com",
    });
    expect(ensureBranchExistsMock).toHaveBeenCalledWith(
      expect.objectContaining({ branch: "draft", fromBranch: "main" }),
    );
  });

  it("appends [skip ci] to the draft commit message (deploy gate)", async () => {
    configurePlatform();
    commitFilesMock.mockResolvedValue("sha");
    await publishPage({
      pageSlug: TEST_SLUG,
      data: { content: [], root: { props: { title: "x" } } },
      authorEmail: "a@e.com",
    });
    const draftMessage = commitFilesMock.mock.calls[0][0].message as string;
    expect(draftMessage).toContain("[skip ci]");
    // No squash commit — the artist publishes explicitly post-PR 3.
    expect(squashBranchIntoMock).not.toHaveBeenCalled();
  });

  it("forwards Authorization Bearer secret to the broker", async () => {
    configurePlatform();
    commitFilesMock.mockResolvedValue("sha");
    await publishPage({ pageSlug: TEST_SLUG, data: { content: [], root: { props: { title: "x" } } }, authorEmail: "a@e.com" });
    const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(fetchCall[0]).toBe("https://platform.example.com/api/publish-token");
    expect(fetchCall[1].headers.authorization).toBe("Bearer broker-secret");
    expect(JSON.parse(fetchCall[1].body)).toEqual({ siteId: "site-123" });
  });

  it("trims trailing slash on platform url", async () => {
    configurePlatform();
    process.env.STAGECRAFT_PLATFORM_URL = "https://platform.example.com/";
    commitFilesMock.mockResolvedValue("sha");
    await publishPage({ pageSlug: TEST_SLUG, data: { content: [], root: { props: { title: "x" } } }, authorEmail: "a@e.com" });
    const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(fetchCall[0]).toBe("https://platform.example.com/api/publish-token");
  });

  it("throws PublishError with broker-unreachable when fetch throws", async () => {
    configurePlatform();
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) as unknown as typeof fetch;
    await expect(
      publishPage({ pageSlug: TEST_SLUG, data: { content: [], root: { props: { title: "x" } } }, authorEmail: "a@e.com" }),
    ).rejects.toMatchObject({ code: "broker-unreachable" });
  });

  it("throws broker-rejected when broker returns non-200", async () => {
    configurePlatform({ ok: false, status: 401, body: { ok: false } });
    await expect(
      publishPage({ pageSlug: TEST_SLUG, data: { content: [], root: { props: { title: "x" } } }, authorEmail: "a@e.com" }),
    ).rejects.toBeInstanceOf(PublishError);
  });

  it("throws broker-rejected when broker response is malformed", async () => {
    configurePlatform({ body: { ok: true, token: "x" } }); // missing repo + expiresAt
    await expect(
      publishPage({ pageSlug: TEST_SLUG, data: { content: [], root: { props: { title: "x" } } }, authorEmail: "a@e.com" }),
    ).rejects.toMatchObject({ code: "broker-rejected" });
  });

  it("wraps GitHub failures as github-failed", async () => {
    configurePlatform();
    commitFilesMock.mockRejectedValue(new Error("ref not found"));
    await expect(
      publishPage({ pageSlug: TEST_SLUG, data: { content: [], root: { props: { title: "x" } } }, authorEmail: "a@e.com" }),
    ).rejects.toMatchObject({ code: "github-failed" });
  });

  it("includes a Stagecraft-Publish-Id trailer in the commit message", async () => {
    configurePlatform();
    commitFilesMock.mockResolvedValue("sha");
    await publishPage({ pageSlug: TEST_SLUG, data: { content: [], root: { props: { title: "x" } } }, authorEmail: "a@e.com" });
    // Post-PR 3: trailer lives on the draft commit (save event).
    // The squash commit is created later by the explicit Publish flow
    // and isn't reached by publishPage anymore.
    const draftMessage = commitFilesMock.mock.calls[0][0].message as string;
    expect(draftMessage).toMatch(/^Update publish-test/);
    expect(draftMessage).toMatch(/Stagecraft-Publish-Id: [0-9a-f-]{36}/);
  });

  it("respects SITE_GIT_BRANCH env override for the draft branch base", async () => {
    configurePlatform();
    process.env.SITE_GIT_BRANCH = "develop";
    commitFilesMock.mockResolvedValue("sha");
    await publishPage({ pageSlug: TEST_SLUG, data: { content: [], root: { props: { title: "x" } } }, authorEmail: "a@e.com" });
    // Save still targets `draft`; the override changes only the
    // branch draft is based on (and what publishDraftToMain would
    // squash into, which publishPage no longer triggers).
    expect(commitFilesMock.mock.calls[0][0].branch).toBe("draft");
    expect(ensureBranchExistsMock).toHaveBeenCalledWith(
      expect.objectContaining({ branch: "draft", fromBranch: "develop" }),
    );
  });
});

describe("publish — multi-target API", () => {
  it("rejects empty target list", async () => {
    await expect(
      publish({ targets: [], authorEmail: "a@e.com" }),
    ).rejects.toBeInstanceOf(PublishError);
  });

  it("custom commitSubject overrides the auto summary", async () => {
    configurePlatform();
    commitFilesMock.mockResolvedValue("sha");
    await publish({
      targets: [
        {
          kind: "collection-item",
          collectionSlug: "pages",
          itemSlug: TEST_SLUG,
          data: { id: "i", ...TS, values: {} },
        },
      ],
      authorEmail: "a@e.com",
      commitSubject: "Custom subject line",
    });
    // The squash commit on main is the user-visible one — assert
    // there. (The draft commit has the same subject plus [skip ci].)
    const squashMessage = squashBranchIntoMock.mock.calls[0][0].message as string;
    expect(squashMessage).toMatch(/^Custom subject line/);
  });
});

// ---------------------------------------------------------------------------
// Collection target kinds (ADR-009)
// ---------------------------------------------------------------------------

describe("publish — collection target kinds", () => {
  it("collection-def writes to <slug>/_collection.json in github mode", async () => {
    configurePlatform();
    commitFilesMock.mockResolvedValue("commit-sha");
    await publish({
      targets: [
        { kind: "collection-def", collectionSlug: "tour-dates", data: tourDatesDef() },
      ],
      authorEmail: "a@e.com",
    });
    const files = commitFilesMock.mock.calls[0][0].files as { path: string }[];
    expect(files[0].path).toBe("src/content/collections/tour-dates/_collection.json");
  });

  it("collection-def rejects an invalid def at the publish layer", async () => {
    configurePlatform();
    commitFilesMock.mockResolvedValue("sha");
    const bad = tourDatesDef();
    bad.fields = [
      { id: "dup", key: "a", type: "text", required: true },
      { id: "dup", key: "b", type: "text", required: true },
    ];
    bad.slugSourceFieldId = null;
    bad.defaultSort = null;
    await expect(
      publish({
        targets: [{ kind: "collection-def", collectionSlug: "tour-dates", data: bad }],
        authorEmail: "a@e.com",
      }),
    ).rejects.toThrow();
    expect(commitFilesMock).not.toHaveBeenCalled();
  });

  it("collection-def rejects a slug mismatch", async () => {
    configurePlatform();
    commitFilesMock.mockResolvedValue("sha");
    await expect(
      publish({
        targets: [
          {
            kind: "collection-def",
            collectionSlug: "tour-dates",
            data: { ...tourDatesDef(), slug: "different" },
          },
        ],
        authorEmail: "a@e.com",
      }),
    ).rejects.toThrow();
    expect(commitFilesMock).not.toHaveBeenCalled();
  });

  it("collection-item writes to items/<itemSlug>.json", async () => {
    configurePlatform();
    commitFilesMock.mockResolvedValue("commit-sha");
    await publish({
      targets: [
        {
          kind: "collection-item",
          collectionSlug: "tour-dates",
          itemSlug: "paris-2026",
          data: { id: "item_p", ...TS, values: {} },
        },
      ],
      authorEmail: "a@e.com",
    });
    const files = commitFilesMock.mock.calls[0][0].files as { path: string }[];
    expect(files[0].path).toBe(
      "src/content/collections/tour-dates/items/paris-2026.json",
    );
  });

  it("collection-item rejects a payload missing the id (structural guard)", async () => {
    configurePlatform();
    commitFilesMock.mockResolvedValue("sha");
    await expect(
      publish({
        targets: [
          {
            kind: "collection-item",
            collectionSlug: "tour-dates",
            itemSlug: "paris-2026",
            data: { values: {} },
          },
        ],
        authorEmail: "a@e.com",
      }),
    ).rejects.toThrow();
    expect(commitFilesMock).not.toHaveBeenCalled();
  });

  it("collection-item rejects a CollectionDef pasted in by mistake", async () => {
    configurePlatform();
    commitFilesMock.mockResolvedValue("sha");
    await expect(
      publish({
        targets: [
          {
            kind: "collection-item",
            collectionSlug: "tour-dates",
            itemSlug: "paris-2026",
            data: tourDatesDef(),
          },
        ],
        authorEmail: "a@e.com",
      }),
    ).rejects.toThrow();
    expect(commitFilesMock).not.toHaveBeenCalled();
  });

  it("delete-collection-item adds to deletePaths instead of writes", async () => {
    configurePlatform();
    commitFilesMock.mockResolvedValue("commit-sha");
    await publish({
      targets: [
        {
          kind: "delete-collection-item",
          collectionSlug: "tour-dates",
          itemSlug: "paris-2026",
        },
      ],
      authorEmail: "a@e.com",
    });
    const args = commitFilesMock.mock.calls[0][0] as { files: unknown[]; deletePaths: string[] };
    expect(args.files).toEqual([]);
    expect(args.deletePaths).toEqual([
      "src/content/collections/tour-dates/items/paris-2026.json",
    ]);
  });

  it("collection-order writes the order list to items/_order.json", async () => {
    configurePlatform();
    commitFilesMock.mockResolvedValue("commit-sha");
    await publish({
      targets: [
        {
          kind: "collection-order",
          collectionSlug: "tour-dates",
          data: ["paris-2026", "berlin-2026"],
        },
      ],
      authorEmail: "a@e.com",
    });
    const files = commitFilesMock.mock.calls[0][0].files as { path: string; content: string }[];
    expect(files[0].path).toBe("src/content/collections/tour-dates/items/_order.json");
    expect(JSON.parse(files[0].content)).toEqual(["paris-2026", "berlin-2026"]);
  });

  it("collection-order rejects invalid slugs in the list", async () => {
    configurePlatform();
    commitFilesMock.mockResolvedValue("sha");
    await expect(
      publish({
        targets: [
          {
            kind: "collection-order",
            collectionSlug: "tour-dates",
            data: ["valid", "NOT-VALID"],
          },
        ],
        authorEmail: "a@e.com",
      }),
    ).rejects.toThrow();
    expect(commitFilesMock).not.toHaveBeenCalled();
  });

  it("dev fallback writes collection-def, items, and order to disk", async () => {
    // No platform configuration → local writes.
    await publish({
      targets: [
        { kind: "collection-def", collectionSlug: "tour-dates", data: tourDatesDef() },
        {
          kind: "collection-item",
          collectionSlug: "tour-dates",
          itemSlug: "paris-2026",
          data: { id: "item_p", ...TS, values: { f_date: { type: "date", value: "2026-07-15" } } },
        },
        {
          kind: "collection-order",
          collectionSlug: "tour-dates",
          data: ["paris-2026"],
        },
      ],
      authorEmail: "a@e.com",
    });
    expect(commitFilesMock).not.toHaveBeenCalled();
    const defOnDisk = JSON.parse(
      await fs.readFile(
        path.join(TMP_CONTENT_DIR, "collections/tour-dates/_collection.json"),
        "utf-8",
      ),
    );
    expect(defOnDisk.slug).toBe("tour-dates");
    const itemOnDisk = JSON.parse(
      await fs.readFile(
        path.join(TMP_CONTENT_DIR, "collections/tour-dates/items/paris-2026.json"),
        "utf-8",
      ),
    );
    expect(itemOnDisk.id).toBe("item_p");
    const orderOnDisk = JSON.parse(
      await fs.readFile(
        path.join(TMP_CONTENT_DIR, "collections/tour-dates/items/_order.json"),
        "utf-8",
      ),
    );
    expect(orderOnDisk).toEqual(["paris-2026"]);
  });

  it("summariseTargets covers each collection target kind", async () => {
    configurePlatform();
    commitFilesMock.mockResolvedValue("sha");
    await publish({
      targets: [
        { kind: "collection-def", collectionSlug: "tour-dates", data: tourDatesDef() },
        {
          kind: "collection-item",
          collectionSlug: "tour-dates",
          itemSlug: "paris-2026",
          data: { id: "i", ...TS, values: {} },
        },
        {
          kind: "collection-order",
          collectionSlug: "tour-dates",
          data: ["paris-2026"],
        },
        {
          kind: "delete-collection-item",
          collectionSlug: "tour-dates",
          itemSlug: "old-show",
        },
      ],
      authorEmail: "a@e.com",
    });
    // Per-target summarisation lives on the SAVE commit (on draft)
    // post-PR 2 — the squash commit on main carries a generic
    // "Publish pending changes" subject because publishDraftToMain
    // doesn't take targets (it ships everything pending in one go).
    const draftMessage = commitFilesMock.mock.calls[0][0].message as string;
    expect(draftMessage).toContain("collection defs: tour-dates");
    expect(draftMessage).toContain("items: tour-dates/paris-2026");
    expect(draftMessage).toContain("order: tour-dates");
    expect(draftMessage).toContain("delete items: tour-dates/old-show");
  });
});

// ---------------------------------------------------------------------------
// saveToDraft — write to draft only, no squash
// ---------------------------------------------------------------------------

describe("saveToDraft", () => {
  const TARGETS = [
    {
      kind: "collection-item" as const,
      collectionSlug: "pages",
      itemSlug: TEST_SLUG,
      data: { id: "i", ...TS, values: {} },
    },
  ];

  it("rejects empty target list", async () => {
    await expect(
      saveToDraft({ targets: [], authorEmail: "a@e.com" }),
    ).rejects.toBeInstanceOf(PublishError);
  });

  it("dev fallback writes locally without calling commitFiles", async () => {
    await saveToDraft({ targets: TARGETS, authorEmail: "a@e.com" });
    expect(commitFilesMock).not.toHaveBeenCalled();
    expect(ensureBranchExistsMock).not.toHaveBeenCalled();
  });

  it("commits to draft and does NOT squash to main", async () => {
    configurePlatform();
    commitFilesMock.mockResolvedValue("draft-sha");
    const result = await saveToDraft({ targets: TARGETS, authorEmail: "a@e.com" });
    expect(result).toEqual({ mode: "github", commitSha: "draft-sha" });
    // No squash — save and publish are separate now.
    expect(squashBranchIntoMock).not.toHaveBeenCalled();
    // Commits target draft with [skip ci].
    const args = commitFilesMock.mock.calls[0][0];
    expect(args.branch).toBe("draft");
    expect(args.message).toContain("[skip ci]");
  });

  it("calls ensureBranchExists before committing", async () => {
    configurePlatform();
    commitFilesMock.mockResolvedValue("draft-sha");
    await saveToDraft({ targets: TARGETS, authorEmail: "a@e.com" });
    expect(ensureBranchExistsMock).toHaveBeenCalledWith(
      expect.objectContaining({ branch: "draft", fromBranch: "main" }),
    );
  });

  it("auto-rebases main into draft before committing (ADR-010 §7)", async () => {
    configurePlatform();
    commitFilesMock.mockResolvedValue("draft-sha");
    await saveToDraft({ targets: TARGETS, authorEmail: "a@e.com" });
    expect(mergeBranchIntoMock).toHaveBeenCalledWith(
      expect.objectContaining({ from: "main", into: "draft" }),
    );
    // The order matters: ensure → merge → commit. If we committed
    // before rebasing, our commit's tree would be based on stale
    // draft state and the next save's tree comparison would lose
    // main's recent changes.
    const ensureOrder = ensureBranchExistsMock.mock.invocationCallOrder[0];
    const mergeOrder = mergeBranchIntoMock.mock.invocationCallOrder[0];
    const commitOrder = commitFilesMock.mock.invocationCallOrder[0];
    expect(ensureOrder).toBeLessThan(mergeOrder);
    expect(mergeOrder).toBeLessThan(commitOrder);
  });

  it("surfaces a structured PublishError on merge conflict", async () => {
    configurePlatform();
    mergeBranchIntoMock.mockResolvedValueOnce({ kind: "conflict" });
    await expect(
      saveToDraft({ targets: TARGETS, authorEmail: "a@e.com" }),
    ).rejects.toMatchObject({
      code: "github-failed",
    });
    // The commit was NOT attempted — a conflict short-circuits the flow.
    expect(commitFilesMock).not.toHaveBeenCalled();
  });

  it("wraps a non-PublishError thrown by mergeBranchInto as auto-rebase: ...", async () => {
    configurePlatform();
    mergeBranchIntoMock.mockRejectedValueOnce(new Error("ECONNRESET"));
    await expect(
      saveToDraft({ targets: TARGETS, authorEmail: "a@e.com" }),
    ).rejects.toMatchObject({
      code: "github-failed",
      message: expect.stringMatching(/^auto-rebase: /),
    });
    expect(commitFilesMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// publishDraftToMain — squash draft into main, no targets
// ---------------------------------------------------------------------------

describe("publishDraftToMain", () => {
  it("dev fallback is a no-op (alreadyInSync: true)", async () => {
    const result = await publishDraftToMain({ authorEmail: "a@e.com" });
    expect(result).toEqual({ commitSha: null, mode: "local", alreadyInSync: true });
    expect(squashBranchIntoMock).not.toHaveBeenCalled();
  });

  it("squashes draft into main and reports the squash SHA", async () => {
    configurePlatform();
    squashBranchIntoMock.mockResolvedValue({
      commitSha: "squash-sha",
      alreadyInSync: false,
    });
    const result = await publishDraftToMain({ authorEmail: "a@e.com" });
    expect(result).toEqual({
      commitSha: "squash-sha",
      mode: "github",
      alreadyInSync: false,
    });
    expect(squashBranchIntoMock).toHaveBeenCalledWith(
      expect.objectContaining({ fromBranch: "draft", toBranch: "main" }),
    );
  });

  it("auto-rebases before squashing (defense in depth alongside saveToDraft's rebase)", async () => {
    configurePlatform();
    await publishDraftToMain({ authorEmail: "a@e.com" });
    expect(mergeBranchIntoMock).toHaveBeenCalledWith(
      expect.objectContaining({ from: "main", into: "draft" }),
    );
  });

  it("reports alreadyInSync when squash short-circuits (nothing pending)", async () => {
    configurePlatform();
    squashBranchIntoMock.mockResolvedValue({
      commitSha: "main-sha",
      alreadyInSync: true,
    });
    const result = await publishDraftToMain({ authorEmail: "a@e.com" });
    expect(result.alreadyInSync).toBe(true);
    expect(result.commitSha).toBe("main-sha");
  });

  it("uses 'Publish pending changes' as the default subject", async () => {
    configurePlatform();
    await publishDraftToMain({ authorEmail: "a@e.com" });
    const message = squashBranchIntoMock.mock.calls[0][0].message as string;
    expect(message).toMatch(/^Publish pending changes/);
    expect(message).toMatch(/Stagecraft-Publish-Id: [0-9a-f-]{36}/);
  });

  it("accepts a commitSubject override", async () => {
    configurePlatform();
    await publishDraftToMain({
      authorEmail: "a@e.com",
      commitSubject: "Ship the spring tour",
    });
    const message = squashBranchIntoMock.mock.calls[0][0].message as string;
    expect(message).toMatch(/^Ship the spring tour/);
  });

  it("surfaces a structured PublishError on merge conflict", async () => {
    configurePlatform();
    mergeBranchIntoMock.mockResolvedValueOnce({ kind: "conflict" });
    await expect(
      publishDraftToMain({ authorEmail: "a@e.com" }),
    ).rejects.toMatchObject({ code: "github-failed" });
    expect(squashBranchIntoMock).not.toHaveBeenCalled();
  });

  it("wraps a non-PublishError thrown by mergeBranchInto as auto-rebase: ...", async () => {
    configurePlatform();
    mergeBranchIntoMock.mockRejectedValueOnce(new Error("rate limit hit"));
    await expect(
      publishDraftToMain({ authorEmail: "a@e.com" }),
    ).rejects.toMatchObject({
      code: "github-failed",
      message: expect.stringMatching(/^auto-rebase: /),
    });
    expect(squashBranchIntoMock).not.toHaveBeenCalled();
  });
});
