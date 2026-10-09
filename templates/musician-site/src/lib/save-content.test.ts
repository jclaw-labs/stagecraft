import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { saveToDraftMock, publishMock } = vi.hoisted(() => ({
  saveToDraftMock: vi.fn(),
  publishMock: vi.fn(),
}));
vi.mock("./publish", async () => {
  const actual = await vi.importActual<typeof import("./publish")>("./publish");
  return { ...actual, saveToDraft: saveToDraftMock, saveAndPublish: publishMock };
});

import {
  planItemWrite,
  saveContent,
  saveFailureResponse,
  saveFailureStatus,
} from "./save-content";
import { DraftSavedPublishError, PublishError, type Env } from "./publish";
import { readItem, type Item } from "./collections";
import { tourDateItem, tourDatesDef as makeTourDatesDef } from "./collections/test-fixtures";

const tourDatesDef = makeTourDatesDef();

const DEV_ENV: Env = {
  platformUrl: "https://platform.example.com",
  siteId: undefined,
  brokerSecret: undefined,
  branch: "main",
};
const PROD_ENV: Env = { ...DEV_ENV, siteId: "site_1", brokerSecret: "secret" };

const ARGS = {
  targets: [{ kind: "delete-collection-item" as const, collectionSlug: "pages", itemSlug: "x" }],
  authorEmail: "a@e.com",
  commitSubject: "Delete x",
};

let TMP_CONTENT_DIR: string;

beforeAll(async () => {
  TMP_CONTENT_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "stagecraft-save-content-"));
});

afterAll(async () => {
  await fs.rm(TMP_CONTENT_DIR, { recursive: true, force: true });
});

beforeEach(async () => {
  saveToDraftMock.mockReset().mockResolvedValue({ commitSha: "draft-sha", mode: "github" });
  publishMock.mockReset().mockResolvedValue({ commitSha: "main-sha", mode: "github" });
  process.env.STAGECRAFT_CONTENT_DIR = TMP_CONTENT_DIR;
  await fs.rm(path.join(TMP_CONTENT_DIR, "collections"), { recursive: true, force: true });
});

afterEach(() => {
  delete process.env.STAGECRAFT_SITE_ID;
  delete process.env.STAGECRAFT_BROKER_SECRET;
  vi.unstubAllEnvs();
});

describe("saveContent", () => {
  it("dev: runs the local write, then the (local-mode) draft save", async () => {
    const order: string[] = [];
    const writeLocal = vi.fn(async () => {
      order.push("local");
    });
    saveToDraftMock.mockImplementation(async () => {
      order.push("draft");
      return { commitSha: null, mode: "local" };
    });

    const result = await saveContent({ ...ARGS, writeLocal }, DEV_ENV);

    expect(result).toEqual({ commitSha: null, mode: "local" });
    expect(order).toEqual(["local", "draft"]);
    // `writeLocal` / `publishTo` are stripped before reaching the publish layer.
    expect(saveToDraftMock).toHaveBeenCalledWith(ARGS);
  });

  it("production: never runs the local write, commits the targets", async () => {
    const writeLocal = vi.fn(async () => {});

    const result = await saveContent({ ...ARGS, writeLocal }, PROD_ENV);

    expect(result).toEqual({ commitSha: "draft-sha", mode: "github" });
    expect(writeLocal).not.toHaveBeenCalled();
    expect(saveToDraftMock).toHaveBeenCalledWith(ARGS);
    expect(publishMock).not.toHaveBeenCalled();
  });

  it("publishTo: 'main' routes through saveAndPublish() instead of saveToDraft()", async () => {
    const result = await saveContent(
      { ...ARGS, writeLocal: async () => {}, publishTo: "main" },
      PROD_ENV,
    );
    expect(result.commitSha).toBe("main-sha");
    expect(publishMock).toHaveBeenCalledWith(ARGS);
    expect(saveToDraftMock).not.toHaveBeenCalled();
  });

  it("production: propagates a commit failure instead of reporting success", async () => {
    saveToDraftMock.mockRejectedValue(new PublishError("github-failed", "boom"));
    const writeLocal = vi.fn(async () => {});
    await expect(saveContent({ ...ARGS, writeLocal }, PROD_ENV)).rejects.toThrow("boom");
    expect(writeLocal).not.toHaveBeenCalled();
  });

  it("dev: a failing local write stops the save before the publish call", async () => {
    await expect(
      saveContent(
        {
          ...ARGS,
          writeLocal: async () => {
            throw new Error("disk full");
          },
        },
        DEV_ENV,
      ),
    ).rejects.toThrow("disk full");
    expect(saveToDraftMock).not.toHaveBeenCalled();
  });

  it("publishTo: 'main', squash fails after the draft commit: resolves with publishWarning, not a failure", async () => {
    publishMock.mockRejectedValue(
      new DraftSavedPublishError(
        "draft-sha",
        new PublishError("github-failed", "squash draft → main: boom"),
      ),
    );
    const result = await saveContent(
      { ...ARGS, writeLocal: async () => {}, publishTo: "main" },
      PROD_ENV,
    );
    expect(result).toMatchObject({ commitSha: "draft-sha", mode: "github" });
    expect(result.publishWarning).toMatch(/^Saved to your draft, but publishing to the live site failed/);
    expect(result.publishWarning).toContain("squash draft → main: boom");
  });

  it("publishTo: 'main', draft commit fails: still a failed save", async () => {
    publishMock.mockRejectedValue(new PublishError("github-failed", "commit to draft: boom"));
    const error = await saveContent(
      { ...ARGS, writeLocal: async () => {}, publishTo: "main" },
      PROD_ENV,
    ).catch((e) => e);
    expect(error).toBeInstanceOf(PublishError);
    expect(error.message).toBe("commit to draft: boom");
  });

  it("production build without platform config: refuses before any write", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const writeLocal = vi.fn(async () => {});
    const error = await saveContent({ ...ARGS, writeLocal }, DEV_ENV).catch((e) => e);
    expect(error).toBeInstanceOf(PublishError);
    expect(error.code).toBe("no-platform-configured");
    expect(error.message).toMatch(/isn't connected to Stagecraft/);
    expect(writeLocal).not.toHaveBeenCalled();
    expect(saveToDraftMock).not.toHaveBeenCalled();
    expect(publishMock).not.toHaveBeenCalled();
  });

  it("production build with platform config: commits as usual", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const result = await saveContent({ ...ARGS, writeLocal: async () => {} }, PROD_ENV);
    expect(result).toEqual({ commitSha: "draft-sha", mode: "github" });
  });

  it("development build without platform config: still writes locally", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const writeLocal = vi.fn(async () => {});
    saveToDraftMock.mockResolvedValue({ commitSha: null, mode: "local" });
    const result = await saveContent({ ...ARGS, writeLocal }, DEV_ENV);
    expect(result).toEqual({ commitSha: null, mode: "local" });
    expect(writeLocal).toHaveBeenCalledTimes(1);
  });

  it("reads the platform config from the environment by default", async () => {
    process.env.STAGECRAFT_SITE_ID = "site_1";
    process.env.STAGECRAFT_BROKER_SECRET = "secret";
    const writeLocal = vi.fn(async () => {});
    await saveContent({ ...ARGS, writeLocal });
    expect(writeLocal).not.toHaveBeenCalled();
  });
});

describe("saveFailureStatus", () => {
  it("maps concurrent-edit to 409", () => {
    expect(saveFailureStatus("concurrent-edit")).toBe(409);
  });

  it("maps no-platform-configured to 503", () => {
    expect(saveFailureStatus("no-platform-configured")).toBe(503);
  });

  it.each(["broker-unreachable", "broker-rejected", "github-failed"] as const)(
    "maps %s to 502",
    (code) => {
      expect(saveFailureStatus(code)).toBe(502);
    },
  );
});

describe("saveFailureResponse", () => {
  it("returns the { ok: false, code, error } envelope with the mapped status", async () => {
    const res = saveFailureResponse(new PublishError("broker-rejected", "Token broker returned 401"));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      ok: false,
      code: "broker-rejected",
      error: "Save failed: Token broker returned 401",
    });
  });

  it("uses 409 for a concurrent edit", async () => {
    const res = saveFailureResponse(new PublishError("concurrent-edit", "heads/draft: exhausted"));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("concurrent-edit");
  });
});

describe("planItemWrite", () => {
  const item: Item = {
    ...tourDateItem("first-show", "2024-06-01", "Roxy", "LA"),
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-02-02T00:00:00.000Z",
  };

  it("builds the canonical item and a matching collection-item target", () => {
    const planned = planItemWrite("tour-dates", "first-show", item, tourDatesDef);
    expect(planned.item.slug).toBe("first-show");
    expect(planned.item.updatedAt).toBe("2024-02-02T00:00:00.000Z");
    expect(planned.target).toEqual({
      kind: "collection-item",
      collectionSlug: "tour-dates",
      itemSlug: "first-show",
      data: {
        id: planned.item.id,
        createdAt: planned.item.createdAt,
        updatedAt: planned.item.updatedAt,
        values: planned.item.values,
      },
    });
  });

  it("pins updatedAt to the override when given", () => {
    const planned = planItemWrite(
      "tour-dates",
      "first-show",
      item,
      tourDatesDef,
      "2025-05-05T00:00:00.000Z",
    );
    expect(planned.item.updatedAt).toBe("2025-05-05T00:00:00.000Z");
    expect(planned.item.createdAt).toBe("2024-01-01T00:00:00.000Z");
  });

  it("validates against the collection schema", () => {
    expect(() =>
      planItemWrite("tour-dates", "first-show", { ...item, values: {} }, tourDatesDef),
    ).toThrow();
  });

  it("does not touch disk until writeLocal is called", async () => {
    const planned = planItemWrite("tour-dates", "first-show", item, tourDatesDef);
    expect(await readItem("tour-dates", "first-show", tourDatesDef)).toBeNull();
    await planned.writeLocal();
    expect(await readItem("tour-dates", "first-show", tourDatesDef)).toEqual(planned.item);
  });
});
