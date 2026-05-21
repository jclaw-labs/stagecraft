import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

const { getSessionMock, commitUploadedImageMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  commitUploadedImageMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getSession: getSessionMock }));
vi.mock("@/lib/commit-image", () => ({ commitUploadedImage: commitUploadedImageMock }));

import { POST } from "./route";
import { uploadErrorSchema, uploadResponseSchema } from "@/lib/image-types";

const TEST_SLUG = "route-test";
const TEST_PUBLIC = path.join(process.cwd(), "public/images", TEST_SLUG);
const ORIGINAL_ENV = { ...process.env };

async function cleanup() {
  await fs.rm(TEST_PUBLIC, { recursive: true, force: true });
}

beforeEach(async () => {
  // Await — fire-and-forget here races with the test's writes when
  // multiple cases run back-to-back (e.g. the it.each over vector
  // formats), producing ENOTEMPTY unhandled rejections.
  await cleanup();
  getSessionMock.mockReset().mockResolvedValue({ email: "artist@example.com" });
  commitUploadedImageMock.mockReset();
  // Tests default to dev fallback (no platform env vars). Broker-path
  // tests opt in by setting STAGECRAFT_PLATFORM_URL/SITE_ID/BROKER_SECRET.
  process.env = { ...ORIGINAL_ENV };
  delete process.env.STAGECRAFT_PLATFORM_URL;
  delete process.env.STAGECRAFT_SITE_ID;
  delete process.env.STAGECRAFT_BROKER_SECRET;
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

afterAll(cleanup);

async function jpegBuffer(width = 800, height = 600): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 100, g: 100, b: 100 } },
  })
    .jpeg({ quality: 80 })
    .toBuffer();
}

function buildRequest(form: FormData): Request {
  return new Request("http://localhost/api/upload-image", { method: "POST", body: form });
}

function configurePlatform() {
  process.env.STAGECRAFT_PLATFORM_URL = "https://platform.test";
  process.env.STAGECRAFT_SITE_ID = "site-1";
  process.env.STAGECRAFT_BROKER_SECRET = "secret";
}

describe("POST /api/upload-image", () => {
  it("returns 401 when there is no session", async () => {
    getSessionMock.mockResolvedValueOnce(null);
    const fd = new FormData();
    fd.append("file", new Blob([new Uint8Array(await jpegBuffer())], { type: "image/jpeg" }), "photo.jpg");
    fd.append("contentSlug", TEST_SLUG);
    fd.append("alt", "x");

    const res = await POST(buildRequest(fd));
    expect(res.status).toBe(401);
  });

  it("dev fallback: returns valid metadata for a JPEG and writes locally", async () => {
    const fd = new FormData();
    fd.append("file", new Blob([new Uint8Array(await jpegBuffer())], { type: "image/jpeg" }), "photo.jpg");
    fd.append("contentSlug", TEST_SLUG);
    fd.append("alt", "test photo");

    const res = await POST(buildRequest(fd));
    expect(res.status).toBe(200);
    const body = await res.json();
    const parsed = uploadResponseSchema.safeParse(body);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.image.alt).toBe("test photo");
      expect(parsed.data.image.contentSlug).toBe(TEST_SLUG);
      expect(parsed.data.image.originalExt).toBe("jpg");
    }
    expect(commitUploadedImageMock).not.toHaveBeenCalled();
  });

  it("rejects missing file", async () => {
    const fd = new FormData();
    fd.append("contentSlug", TEST_SLUG);
    fd.append("alt", "x");

    const res = await POST(buildRequest(fd));
    expect(res.status).toBe(400);
    expect(uploadErrorSchema.safeParse(await res.json()).success).toBe(true);
  });

  it("rejects empty file", async () => {
    const fd = new FormData();
    fd.append("file", new Blob([], { type: "image/jpeg" }), "empty.jpg");
    fd.append("contentSlug", TEST_SLUG);
    fd.append("alt", "x");

    const res = await POST(buildRequest(fd));
    expect(res.status).toBe(400);
  });

  it("rejects unsupported mime type", async () => {
    const fd = new FormData();
    fd.append("file", new Blob([new Uint8Array(Buffer.from("not an image"))], { type: "text/plain" }), "x.txt");
    fd.append("contentSlug", TEST_SLUG);
    fd.append("alt", "x");

    const res = await POST(buildRequest(fd));
    expect(res.status).toBe(415);
  });

  // ---------------------------------------------------------------------------
  // Vector / icon uploads — the bypass path. Locks acceptance of the new
  // MIME types so a future tightening of `ALLOWED_INPUT_MIME_TYPES` (for
  // perf or security) surfaces as a route-test failure before an artist
  // hits the broken upload UI.
  // ---------------------------------------------------------------------------

  it.each([
    ["SVG", "image/svg+xml", "logo.svg", "svg" as const],
    ["ICO (vnd.microsoft.icon)", "image/vnd.microsoft.icon", "favicon.ico", "ico" as const],
    ["ICO (x-icon alias)", "image/x-icon", "favicon.ico", "ico" as const],
  ])("dev fallback: accepts %s uploads and bypasses sharp", async (_label, mime, filename, ext) => {
    // Minimal payload — the bypass branch doesn't parse SVG/ICO bytes,
    // so a non-empty buffer is sufficient. Tests for actual content
    // preservation live in image.test.ts.
    const payload =
      ext === "svg"
        ? Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>', "utf-8")
        : Buffer.from([0, 0, 1, 0, 1, 0, 16, 16, 0, 0, 1, 0, 32, 0]);

    const fd = new FormData();
    fd.append("file", new Blob([new Uint8Array(payload)], { type: mime }), filename);
    fd.append("contentSlug", TEST_SLUG);
    fd.append("alt", "icon");

    const res = await POST(buildRequest(fd));
    expect(res.status).toBe(200);
    const body = await res.json();
    const parsed = uploadResponseSchema.safeParse(body);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.image.originalExt).toBe(ext);
    }
  });

  it("rejects invalid contentSlug", async () => {
    const fd = new FormData();
    fd.append("file", new Blob([new Uint8Array(await jpegBuffer())], { type: "image/jpeg" }), "photo.jpg");
    fd.append("contentSlug", "Not A Slug!");
    fd.append("alt", "x");

    const res = await POST(buildRequest(fd));
    expect(res.status).toBe(400);
  });

  it("dedups: re-uploading the same bytes is idempotent", async () => {
    const buffer = await jpegBuffer();

    const upload = async () => {
      const fd = new FormData();
      fd.append("file", new Blob([new Uint8Array(buffer)], { type: "image/jpeg" }), "photo.jpg");
      fd.append("contentSlug", TEST_SLUG);
      fd.append("alt", "dedup test");
      return POST(buildRequest(fd));
    };

    const a = await (await upload()).json();
    const b = await (await upload()).json();
    expect(a.image.id).toBe(b.image.id);
  });

  describe("broker path (platform configured)", () => {
    beforeEach(configurePlatform);

    it("calls commitUploadedImage with session email + processed input", async () => {
      commitUploadedImageMock.mockResolvedValue({
        metadata: {
          id: "abc1234567890def",
          alt: "broker test",
          width: 800,
          height: 600,
          placeholderDataUri: "data:image/webp;base64,AAAA",
          contentSlug: TEST_SLUG,
          originalExt: "jpg",
        },
        commitSha: "deadbeef",
      });

      const fd = new FormData();
      fd.append("file", new Blob([new Uint8Array(await jpegBuffer())], { type: "image/jpeg" }), "photo.jpg");
      fd.append("contentSlug", TEST_SLUG);
      fd.append("alt", "broker test");

      const res = await POST(buildRequest(fd));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(uploadResponseSchema.safeParse(body).success).toBe(true);
      expect(commitUploadedImageMock).toHaveBeenCalledWith(
        expect.objectContaining({
          authorEmail: "artist@example.com",
          input: expect.objectContaining({
            contentSlug: TEST_SLUG,
            alt: "broker test",
            originalExt: "jpg",
          }),
        }),
      );
    });

    it("maps broker-rejected errors to 502", async () => {
      const { PublishError } = await import("@/lib/publish");
      commitUploadedImageMock.mockRejectedValue(new PublishError("broker-rejected", "401"));

      const fd = new FormData();
      fd.append("file", new Blob([new Uint8Array(await jpegBuffer())], { type: "image/jpeg" }), "photo.jpg");
      fd.append("contentSlug", TEST_SLUG);
      fd.append("alt", "x");

      const res = await POST(buildRequest(fd));
      expect(res.status).toBe(502);
    });

    it("maps github-failed errors to 500", async () => {
      const { PublishError } = await import("@/lib/publish");
      commitUploadedImageMock.mockRejectedValue(new PublishError("github-failed", "boom"));

      const fd = new FormData();
      fd.append("file", new Blob([new Uint8Array(await jpegBuffer())], { type: "image/jpeg" }), "photo.jpg");
      fd.append("contentSlug", TEST_SLUG);
      fd.append("alt", "x");

      const res = await POST(buildRequest(fd));
      expect(res.status).toBe(500);
    });
  });
});
