import { describe, expect, it, vi } from "vitest";

import { uploadImageFromClient, EDITOR_UPLOAD_SLUG } from "./upload-image-client";

function makeFile(size: number, type: string, name = "x.jpg"): File {
  const bytes = new Uint8Array(size);
  return new File([bytes], name, { type });
}

const MIN_VALID_METADATA = {
  id: "abc1234567890def",
  alt: "x",
  width: 800,
  height: 600,
  placeholderDataUri: "data:image/webp;base64,AAAA",
  contentSlug: EDITOR_UPLOAD_SLUG,
  originalExt: "jpg" as const,
};

describe("uploadImageFromClient", () => {
  it("rejects empty file with code=empty before any fetch", async () => {
    const fetchMock = vi.fn();
    await expect(
      uploadImageFromClient({
        file: makeFile(0, "image/jpeg"),
        alt: "x",
        fetchImpl: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: "empty" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects oversized file with code=too-large", async () => {
    const fetchMock = vi.fn();
    await expect(
      uploadImageFromClient({
        file: makeFile(26 * 1024 * 1024, "image/jpeg"),
        alt: "x",
        fetchImpl: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: "too-large" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects unsupported mime with code=invalid-mime", async () => {
    const fetchMock = vi.fn();
    await expect(
      uploadImageFromClient({
        file: makeFile(100, "text/plain", "x.txt"),
        alt: "x",
        fetchImpl: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: "invalid-mime" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("happy path: POSTs the form to /api/upload-image and returns parsed metadata", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, image: MIN_VALID_METADATA }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const result = await uploadImageFromClient({
      file: makeFile(1024, "image/jpeg"),
      alt: "hero",
      contentSlug: "homepage",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(result.image.id).toBe("abc1234567890def");
    expect(fetchMock).toHaveBeenCalledOnce();
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[1].method).toBe("POST");
    expect(call[1].body).toBeInstanceOf(FormData);
  });

  it("defaults contentSlug to EDITOR_UPLOAD_SLUG when not provided", async () => {
    const fetchMock = vi.fn(async (_url: unknown, init: { body: FormData }) => {
      // assert here so we capture the form contents at call time
      const body = init.body;
      expect(body.get("contentSlug")).toBe(EDITOR_UPLOAD_SLUG);
      return new Response(JSON.stringify({ ok: true, image: MIN_VALID_METADATA }), { status: 200 });
    });
    await uploadImageFromClient({
      file: makeFile(1024, "image/jpeg"),
      alt: "x",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
  });

  it("maps server error JSON to code=server-error with the server's message", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ok: false, error: "boom" }), { status: 500 }),
    );
    await expect(
      uploadImageFromClient({
        file: makeFile(1024, "image/jpeg"),
        alt: "x",
        fetchImpl: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: "server-error", message: "boom" });
  });

  it("maps fetch throw to code=request-failed", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("offline");
    });
    await expect(
      uploadImageFromClient({
        file: makeFile(1024, "image/jpeg"),
        alt: "x",
        fetchImpl: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: "request-failed" });
  });

  // ---------------------------------------------------------------------------
  // Editorial metadata wire format. FormData is string-only; focalPoint
  // ships as a JSON string. Caption / credit are bare strings, omitted
  // when empty so the route never sees an `""` it has to gate.
  // ---------------------------------------------------------------------------

  it("appends caption / credit / focalPoint when provided", async () => {
    const fetchMock = vi.fn(async (_url: unknown, init: { body: FormData }) => {
      const body = init.body;
      expect(body.get("caption")).toBe("Soundcheck");
      expect(body.get("credit")).toBe("Photo by Jane");
      expect(body.get("focalPoint")).toBe(JSON.stringify({ x: 0.3, y: 0.7 }));
      return new Response(JSON.stringify({ ok: true, image: MIN_VALID_METADATA }), { status: 200 });
    });
    await uploadImageFromClient({
      file: makeFile(1024, "image/jpeg"),
      alt: "x",
      caption: "Soundcheck",
      credit: "Photo by Jane",
      focalPoint: { x: 0.3, y: 0.7 },
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
  });

  it("omits caption / credit / focalPoint keys entirely when not provided", async () => {
    // The route distinguishes "absent" from "empty"; we don't want
    // the client to send empty strings that look like cleared edits.
    const fetchMock = vi.fn(async (_url: unknown, init: { body: FormData }) => {
      const body = init.body;
      expect(body.has("caption")).toBe(false);
      expect(body.has("credit")).toBe(false);
      expect(body.has("focalPoint")).toBe(false);
      return new Response(JSON.stringify({ ok: true, image: MIN_VALID_METADATA }), { status: 200 });
    });
    await uploadImageFromClient({
      file: makeFile(1024, "image/jpeg"),
      alt: "x",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
  });

  it("treats empty caption / credit strings as absent (omits the key)", async () => {
    const fetchMock = vi.fn(async (_url: unknown, init: { body: FormData }) => {
      const body = init.body;
      expect(body.has("caption")).toBe(false);
      expect(body.has("credit")).toBe(false);
      return new Response(JSON.stringify({ ok: true, image: MIN_VALID_METADATA }), { status: 200 });
    });
    await uploadImageFromClient({
      file: makeFile(1024, "image/jpeg"),
      alt: "x",
      caption: "",
      credit: "",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
  });

  // ---------------------------------------------------------------------------
  // Sanitised-info forwarding. The route returns the SVG sanitiser's removal
  // descriptors alongside `image` when the upload was an SVG with stripped
  // content. The picker UI keys on the presence of `sanitised` to decide
  // whether to show the "we stripped N items from your SVG" banner — so
  // the client must surface it through unchanged.
  // ---------------------------------------------------------------------------

  it("returns `sanitised` when the server includes it in the response", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ok: true,
          image: MIN_VALID_METADATA,
          sanitised: { removed: ["<script>", "onclick="] },
        }),
        { status: 200 },
      ),
    );
    const result = await uploadImageFromClient({
      file: makeFile(1024, "image/jpeg"),
      alt: "x",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(result.sanitised).toEqual({ removed: ["<script>", "onclick="] });
  });

  it("omits `sanitised` from the result when the server doesn't send one", async () => {
    // The picker UI checks `result.sanitised` for truthiness; a stale
    // banner from a previous upload shouldn't survive a clean re-upload.
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, image: MIN_VALID_METADATA }), { status: 200 }),
    );
    const result = await uploadImageFromClient({
      file: makeFile(1024, "image/jpeg"),
      alt: "x",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(result.sanitised).toBeUndefined();
  });

  it("rejects a malformed `sanitised` (empty array) as server-error", async () => {
    // The schema guards `removed: z.array(z.string()).min(1)` — an
    // empty `removed` array is "we sanitised but stripped nothing,"
    // which the server contract says should be `sanitised: undefined`
    // instead. A misbehaving server that emits the empty form should
    // be caught at parse time, not silently flow as a no-op signal.
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ ok: true, image: MIN_VALID_METADATA, sanitised: { removed: [] } }),
        { status: 200 },
      ),
    );
    await expect(
      uploadImageFromClient({
        file: makeFile(1024, "image/jpeg"),
        alt: "x",
        fetchImpl: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: "server-error" });
  });
});
