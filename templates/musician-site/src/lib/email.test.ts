import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: sendMock };
  },
}));

import {
  isResendSandboxSender,
  MAGIC_LINK_FROM_DEFAULT,
  sendContactEmail,
  sendMagicLink,
} from "./email";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  sendMock.mockReset();
  process.env = { ...ORIGINAL_ENV };
  delete process.env.RESEND_API_KEY;
  delete process.env.MAGIC_LINK_FROM;
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isResendSandboxSender", () => {
  it("returns true when MAGIC_LINK_FROM is unset", () => {
    expect(isResendSandboxSender()).toBe(true);
  });

  it("returns true when MAGIC_LINK_FROM equals the sandbox sender", () => {
    process.env.MAGIC_LINK_FROM = MAGIC_LINK_FROM_DEFAULT;
    expect(isResendSandboxSender()).toBe(true);
  });

  it("returns false once a custom from address is provisioned", () => {
    process.env.MAGIC_LINK_FROM = "hello@artist.com";
    expect(isResendSandboxSender()).toBe(false);
  });
});

describe("sendMagicLink", () => {
  it("logs locally when RESEND_API_KEY is unset (no Resend call)", async () => {
    const logSpy = vi.spyOn(console, "log");
    await sendMagicLink("a@b.c", "https://x/verify?token=1");
    expect(sendMock).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("https://x/verify?token=1"),
    );
  });

  it("sends through Resend using the sandbox sender by default", async () => {
    process.env.RESEND_API_KEY = "re_test";
    sendMock.mockResolvedValue({ id: "ok" });
    await sendMagicLink("a@b.c", "https://x");
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        from: MAGIC_LINK_FROM_DEFAULT,
        to: "a@b.c",
      }),
    );
  });

  it("respects MAGIC_LINK_FROM when set", async () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.MAGIC_LINK_FROM = "hello@artist.com";
    sendMock.mockResolvedValue({ id: "ok" });
    await sendMagicLink("a@b.c", "https://x");
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({ from: "hello@artist.com" }),
    );
  });
});

describe("sendContactEmail", () => {
  const baseMessage = {
    to: "artist@example.com",
    replyTo: "fan@example.com",
    fromName: "A Fan",
    subject: "[Contact] Booking inquiry",
    body: "Hello, can you play our venue?",
    siteName: "Pumpkin Bread",
  };

  it("logs locally when RESEND_API_KEY is unset", async () => {
    const logSpy = vi.spyOn(console, "log");
    await sendContactEmail(baseMessage);
    expect(sendMock).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("fan@example.com"));
  });

  it("uses the site name in the from header and routes replies to the submitter", async () => {
    process.env.RESEND_API_KEY = "re_test";
    sendMock.mockResolvedValue({ id: "ok" });
    await sendContactEmail(baseMessage);
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        from: `Pumpkin Bread <${MAGIC_LINK_FROM_DEFAULT}>`,
        to: "artist@example.com",
        replyTo: "fan@example.com",
        subject: "[Contact] Booking inquiry",
      }),
    );
  });

  it("includes name / email / subject in the plain-text body", async () => {
    process.env.RESEND_API_KEY = "re_test";
    sendMock.mockResolvedValue({ id: "ok" });
    await sendContactEmail(baseMessage);
    const call = sendMock.mock.calls[0][0];
    expect(call.text).toContain("Name: A Fan");
    expect(call.text).toContain("Email: fan@example.com");
    expect(call.text).toContain("Hello, can you play our venue?");
  });

  it("respects MAGIC_LINK_FROM when set", async () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.MAGIC_LINK_FROM = "hello@artist.com";
    sendMock.mockResolvedValue({ id: "ok" });
    await sendContactEmail(baseMessage);
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({ from: "Pumpkin Bread <hello@artist.com>" }),
    );
  });
});
