import { describe, it, expect } from "vitest";
import { toClientSite } from "../client-site";

describe("toClientSite", () => {
  it("drops the broker secret hash and keeps the other site fields", () => {
    const site = toClientSite({ id: "site-1", name: "Band", brokerSecretHash: "hash", jobs: [] });
    expect(site).toEqual({ id: "site-1", name: "Band", jobs: [] });
    expect(site).not.toHaveProperty("brokerSecretHash");
  });

  it("narrows retired job values and keeps current ones", () => {
    const site = toClientSite({
      id: "site-1",
      brokerSecretHash: null,
      jobs: [
        { id: "job-1", type: "edit_site", status: "awaiting_review", failureCategory: "ai_error" },
        { id: "job-2", type: "create_site", status: "failed", failureCategory: "timeout" },
      ],
    });
    expect(site.jobs).toEqual([
      { id: "job-1", type: null, status: null, failureCategory: "unknown" },
      { id: "job-2", type: "create_site", status: "failed", failureCategory: "timeout" },
    ]);
  });
});
