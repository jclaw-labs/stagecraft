import { describe, expect, it } from "vitest";

import { STAGECRAFT_GITHUB_APP_INSTALL_URL, buildInstallUrl } from "../install-url";
import { verifyInstallState } from "../state-signing";

const ORIGINAL_ENV = { ...process.env };

describe("buildInstallUrl", () => {
  it("uses the hardcoded stagecraft-bot install URL and round-trips the signed state", async () => {
    process.env.STAGECRAFT_STATE_SIGNING_SECRET = "test-state-secret-do-not-use";
    try {
      const url = await buildInstallUrl({ siteId: "s1", userId: "u1" });
      const parsed = new URL(url);
      expect(parsed.host).toBe("github.com");
      expect(parsed.pathname).toBe("/apps/stagecraft-bot/installations/new");
      const state = parsed.searchParams.get("state");
      expect(state).toBeTruthy();
      expect(await verifyInstallState(state!)).toEqual({ siteId: "s1", userId: "u1" });
    } finally {
      process.env = { ...ORIGINAL_ENV };
    }
  });

  it("exports the canonical install URL as a constant for non-stateful consumers", () => {
    expect(STAGECRAFT_GITHUB_APP_INSTALL_URL).toBe(
      "https://github.com/apps/stagecraft-bot/installations/new",
    );
  });
});
