import { describe, expect, it } from "vitest";

import { GITHUB_OAUTH_SCOPE, GITHUB_OAUTH_SCOPES } from "../github-oauth-scope";

describe("GitHub OAuth scope", () => {
  it("requests exactly the scopes the platform needs", () => {
    expect(GITHUB_OAUTH_SCOPE).toBe("read:user user:email repo workflow");
  });

  it("does not request delete_repo", () => {
    expect(GITHUB_OAUTH_SCOPE.split(" ")).not.toContain("delete_repo");
    expect(GITHUB_OAUTH_SCOPES as readonly string[]).not.toContain("delete_repo");
  });
});
