import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

const {
  commitFilesMock,
  ensureBranchExistsMock,
  squashBranchIntoMock,
  fetchPublishTokenMock,
} = vi.hoisted(() => ({
  commitFilesMock: vi.fn(),
  ensureBranchExistsMock: vi.fn(),
  squashBranchIntoMock: vi.fn(),
  fetchPublishTokenMock: vi.fn(),
}));

vi.mock("./git-commit", () => ({
  commitFiles: commitFilesMock,
  ensureBranchExists: ensureBranchExistsMock,
  squashBranchInto: squashBranchIntoMock,
}));

vi.mock("./publish", async () => {
  const actual = await vi.importActual<typeof import("./publish")>("./publish");
  return { ...actual, fetchPublishToken: fetchPublishTokenMock };
});

import { commitUploadedImage } from "./commit-image";
import { PublishError } from "./publish";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  commitFilesMock.mockReset();
  ensureBranchExistsMock.mockReset().mockResolvedValue(undefined);
  squashBranchIntoMock
    .mockReset()
    .mockResolvedValue({ commitSha: "squash-sha", alreadyInSync: false });
  fetchPublishTokenMock.mockReset();
  process.env = { ...ORIGINAL_ENV };
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

function configurePlatform() {
  process.env.STAGECRAFT_PLATFORM_URL = "https://platform.test";
  process.env.STAGECRAFT_SITE_ID = "site-1";
  process.env.STAGECRAFT_BROKER_SECRET = "secret";
}

async function jpeg(width = 400, height = 300): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 50, g: 100, b: 150 } },
  })
    .jpeg({ quality: 80 })
    .toBuffer();
}

describe("commitUploadedImage", () => {
  it("throws no-platform-configured when env vars are missing", async () => {
    const buffer = await jpeg();
    await expect(
      commitUploadedImage({
        input: { buffer, contentSlug: "x", alt: "a", originalExt: "jpg" },
        authorEmail: "a@e.com",
      }),
    ).rejects.toThrow(PublishError);
  });

  it("happy path: fetches token, commits original + variants as base64", async () => {
    configurePlatform();
    fetchPublishTokenMock.mockResolvedValue({ token: "t", owner: "o", repo: "r" });
    commitFilesMock.mockResolvedValue("draft-sha");
    squashBranchIntoMock.mockResolvedValue({
      commitSha: "main-squash-sha",
      alreadyInSync: false,
    });

    const buffer = await jpeg();
    const result = await commitUploadedImage({
      input: { buffer, contentSlug: "homepage", alt: "hero", originalExt: "jpg" },
      authorEmail: "artist@example.com",
    });

    // Per ADR-010, the reported SHA is the squash commit on main.
    expect(result.commitSha).toBe("main-squash-sha");
    expect(result.metadata.contentSlug).toBe("homepage");
    expect(result.metadata.alt).toBe("hero");

    expect(fetchPublishTokenMock).toHaveBeenCalledOnce();
    expect(ensureBranchExistsMock).toHaveBeenCalledWith(
      expect.objectContaining({ branch: "draft", fromBranch: "main" }),
    );
    expect(commitFilesMock).toHaveBeenCalledOnce();
    expect(squashBranchIntoMock).toHaveBeenCalledOnce();

    const args = commitFilesMock.mock.calls[0][0];
    // Image blobs land on draft (not main); the [skip ci] marker
    // keeps the deploy from running for the per-upload commit.
    expect(args.branch).toBe("draft");
    expect(args.message).toContain("[skip ci]");
    expect(args.owner).toBe("o");
    expect(args.repo).toBe("r");
    expect(args.token).toBe("t");
    expect(args.author).toEqual({ name: "Artist", email: "artist@example.com" });

    // 1 original + 3 widths × 2 formats = 7 files
    expect(args.files).toHaveLength(7);
    // All committed as base64 (binary safe).
    expect(args.files.every((f: { encoding: string }) => f.encoding === "base64")).toBe(true);
    // Original sits at the canonical path.
    const originalPaths = args.files
      .filter((f: { path: string }) => f.path.endsWith("original.jpg"))
      .map((f: { path: string }) => f.path);
    expect(originalPaths).toHaveLength(1);
    expect(originalPaths[0]).toMatch(
      /^public\/images\/homepage\/[0-9a-f]{16}\/original\.jpg$/,
    );
    // Variants follow the {width}.{format} naming.
    const variantNames = args.files
      .map((f: { path: string }) => f.path.split("/").pop())
      .filter((n: string) => !n.startsWith("original"))
      .sort();
    expect(variantNames).toEqual(
      ["1600.avif", "1600.webp", "400.avif", "400.webp", "800.avif", "800.webp"].sort(),
    );
  });

  it("uses the supplied authorName when provided", async () => {
    configurePlatform();
    fetchPublishTokenMock.mockResolvedValue({ token: "t", owner: "o", repo: "r" });
    commitFilesMock.mockResolvedValue("c");

    await commitUploadedImage({
      input: { buffer: await jpeg(), contentSlug: "x", alt: "y", originalExt: "jpg" },
      authorEmail: "a@e.com",
      authorName: "Sarah Chen",
    });

    expect(commitFilesMock.mock.calls[0][0].author).toEqual({
      name: "Sarah Chen",
      email: "a@e.com",
    });
  });

  it("wraps commitFiles errors in PublishError(github-failed)", async () => {
    configurePlatform();
    fetchPublishTokenMock.mockResolvedValue({ token: "t", owner: "o", repo: "r" });
    commitFilesMock.mockRejectedValue(new Error("422 Reference does not exist"));

    let caught: unknown;
    try {
      await commitUploadedImage({
        input: { buffer: await jpeg(), contentSlug: "x", alt: "y", originalExt: "jpg" },
        authorEmail: "a@e.com",
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(PublishError);
    expect((caught as PublishError).code).toBe("github-failed");
    expect((caught as PublishError).message).toMatch(/Reference does not exist/);
  });
});
