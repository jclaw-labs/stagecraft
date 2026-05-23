import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { sendMagicLinkMock } = vi.hoisted(() => ({ sendMagicLinkMock: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendMagicLink: sendMagicLinkMock }));

import { POST } from "./route";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  sendMagicLinkMock.mockReset();
  process.env = { ...ORIGINAL_ENV };
  process.env.MAGIC_LINK_SIGNING_SECRET = "test-secret-do-not-use";
  delete process.env.ADMIN_EMAIL;
  delete process.env.ADMIN_EMAILS;
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function buildRequest(email: string): Request {
  const fd = new FormData();
  fd.append("email", email);
  return new Request("http://localhost/api/auth/request", { method: "POST", body: fd });
}

describe("POST /api/auth/request", () => {
  it("always redirects to ?sent=1 to prevent enumeration", async () => {
    process.env.ADMIN_EMAIL = "allowed@example.com";
    const res = await POST(buildRequest("nope@example.com"));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("/admin/login?sent=1");
  });

  it("sends a magic link when email matches ADMIN_EMAIL (case-insensitive)", async () => {
    process.env.ADMIN_EMAIL = "Allowed@Example.com";
    await POST(buildRequest("ALLOWED@example.COM"));
    expect(sendMagicLinkMock).toHaveBeenCalledTimes(1);
    expect(sendMagicLinkMock.mock.calls[0][0]).toBe("allowed@example.com");
  });

  it("does not send when email mismatches", async () => {
    process.env.ADMIN_EMAIL = "allowed@example.com";
    await POST(buildRequest("other@example.com"));
    expect(sendMagicLinkMock).not.toHaveBeenCalled();
  });

  describe("editor allowlist (ADMIN_EMAILS)", () => {
    it("sends a magic link when the email is on the allowlist", async () => {
      process.env.ADMIN_EMAILS = "artist@example.com, manager@example.com";
      await POST(buildRequest("MANAGER@example.com"));
      expect(sendMagicLinkMock).toHaveBeenCalledTimes(1);
      expect(sendMagicLinkMock.mock.calls[0][0]).toBe("manager@example.com");
    });

    it("does not send when the email is off the allowlist", async () => {
      process.env.ADMIN_EMAILS = "artist@example.com, manager@example.com";
      await POST(buildRequest("stranger@example.com"));
      expect(sendMagicLinkMock).not.toHaveBeenCalled();
    });

    it("honors the legacy ADMIN_EMAIL unioned with ADMIN_EMAILS", async () => {
      process.env.ADMIN_EMAILS = "manager@example.com";
      process.env.ADMIN_EMAIL = "artist@example.com";
      await POST(buildRequest("artist@example.com"));
      expect(sendMagicLinkMock).toHaveBeenCalledTimes(1);
      expect(sendMagicLinkMock.mock.calls[0][0]).toBe("artist@example.com");
    });
  });

  describe("dev-mode fallback", () => {
    it("sends a magic link to any email when ADMIN_EMAIL is unset (dev only)", async () => {
      vi.stubEnv("NODE_ENV", "development");
      const warnSpy = vi.spyOn(console, "warn");
      vi.resetModules();
      const { POST: devPost } = await import("./route");
      await devPost(buildRequest("anything@example.com"));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("No editor allowlist set"));
      expect(sendMagicLinkMock).toHaveBeenCalledTimes(1);
      expect(sendMagicLinkMock.mock.calls[0][0]).toBe("anything@example.com");
    });

    it("warns and does not send when email is off the allowlist (dev only)", async () => {
      vi.stubEnv("NODE_ENV", "development");
      process.env.ADMIN_EMAIL = "allowed@example.com";
      const warnSpy = vi.spyOn(console, "warn");
      vi.resetModules();
      const { POST: devPost } = await import("./route");
      await devPost(buildRequest("other@example.com"));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("not on the editor allowlist"));
      expect(sendMagicLinkMock).not.toHaveBeenCalled();
    });

    it("silently no-ops in production when ADMIN_EMAIL is unset", async () => {
      vi.stubEnv("NODE_ENV", "production");
      const warnSpy = vi.spyOn(console, "warn");
      vi.resetModules();
      const { POST: prodPost } = await import("./route");
      await prodPost(buildRequest("anything@example.com"));
      expect(warnSpy).not.toHaveBeenCalled();
      expect(sendMagicLinkMock).not.toHaveBeenCalled();
    });
  });
});
