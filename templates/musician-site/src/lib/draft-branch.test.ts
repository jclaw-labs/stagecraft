import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DRAFT_BRANCH,
  resolveDraftBranch,
  resolveDraftBranchForRequest,
} from "./draft-branch";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.ADMIN_EMAIL;
  delete process.env.ADMIN_EMAILS;
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
  vi.restoreAllMocks();
});

describe("resolveDraftBranch", () => {
  it("returns the shared draft for an empty/blank email", () => {
    process.env.ADMIN_EMAILS = "a@x.com, b@y.com";
    expect(resolveDraftBranch("")).toBe(DRAFT_BRANCH);
    expect(resolveDraftBranch("   ")).toBe(DRAFT_BRANCH);
  });

  it("returns the shared draft when no editors are configured", () => {
    expect(resolveDraftBranch("anyone@example.com")).toBe(DRAFT_BRANCH);
  });

  it("returns the shared draft for a single-editor site", () => {
    process.env.ADMIN_EMAIL = "solo@example.com";
    expect(resolveDraftBranch("solo@example.com")).toBe(DRAFT_BRANCH);
    // Even an unknown email maps to the shared branch on a 1-editor site.
    expect(resolveDraftBranch("other@example.com")).toBe(DRAFT_BRANCH);
  });

  describe("multi-editor site", () => {
    beforeEach(() => {
      process.env.ADMIN_EMAILS = "first@example.com, second@example.com";
    });

    it("gives every editor — including the first — an isolated draft-<key> sibling branch", () => {
      for (const email of ["first@example.com", "second@example.com"]) {
        const branch = resolveDraftBranch(email);
        expect(branch).toMatch(/^draft-[0-9a-f]{12}$/);
        expect(branch).not.toBe(DRAFT_BRANCH);
        // Hyphen, not slash: must never D/F-conflict with refs/heads/draft.
        expect(branch.startsWith("draft/")).toBe(false);
      }
    });

    it("derives a stable, case/whitespace-insensitive key per editor", () => {
      expect(resolveDraftBranch("second@example.com")).toBe(
        resolveDraftBranch("  SECOND@Example.com "),
      );
    });

    it("is independent of ADMIN_EMAILS ordering (stable per editor)", () => {
      const before = resolveDraftBranch("second@example.com");
      process.env.ADMIN_EMAILS = "second@example.com, first@example.com";
      expect(resolveDraftBranch("second@example.com")).toBe(before);
    });

    it("gives different editors different branches", () => {
      process.env.ADMIN_EMAILS = "a@x.com, b@x.com, c@x.com";
      const a = resolveDraftBranch("a@x.com");
      const b = resolveDraftBranch("b@x.com");
      expect(a).not.toBe(b);
      expect(a).toMatch(/^draft-[0-9a-f]{12}$/);
      expect(b).toMatch(/^draft-[0-9a-f]{12}$/);
    });
  });
});

describe("resolveDraftBranchForRequest", () => {
  it("falls back to the shared draft when there's no session / request scope", async () => {
    // getSession() reads cookies(), which throws outside a request scope
    // (as in this unit test); the helper swallows that and returns the
    // shared branch rather than a per-editor one.
    process.env.ADMIN_EMAILS = "a@x.com, b@x.com";
    await expect(resolveDraftBranchForRequest()).resolves.toBe(DRAFT_BRANCH);
  });
});
