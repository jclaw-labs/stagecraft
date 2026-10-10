import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCreate = vi.fn();

vi.mock("@stagecraft/db", () => ({
  prisma: {
    siteJob: { create: mockCreate },
  },
}));

const { enqueue } = await import("../enqueue");

describe("enqueue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a queued job with the given options", async () => {
    const fakeJob = { id: "job-1", status: "queued", type: "create_site" };
    mockCreate.mockResolvedValue(fakeJob);

    const result = await enqueue({
      siteId: "site-1",
      userId: "user-1",
      type: "create_site",
    });

    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        siteId: "site-1",
        userId: "user-1",
        type: "create_site",
        status: "queued",
        requestPayload: undefined,
      },
    });
    expect(result).toBe(fakeJob);
  });

  it("passes payload when provided", async () => {
    mockCreate.mockResolvedValue({ id: "job-2" });

    await enqueue({
      siteId: "site-1",
      userId: "user-1",
      type: "migrate_site",
      payload: { url: "https://example.com" },
    });

    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        requestPayload: { url: "https://example.com" },
      }),
    });
  });
});
