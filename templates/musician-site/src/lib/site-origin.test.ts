import { describe, expect, it } from "vitest";

import { deployedSiteOrigin } from "./site-origin";

describe("deployedSiteOrigin", () => {
  it("reads the site's origin from Netlify's URL", () => {
    expect(deployedSiteOrigin({ URL: "https://juneharlow.com" })?.href).toBe(
      "https://juneharlow.com/",
    );
  });

  it("drops any path, so root-relative image URLs resolve from the root", () => {
    expect(deployedSiteOrigin({ URL: "https://juneharlow.netlify.app/sub/" })?.href).toBe(
      "https://juneharlow.netlify.app/",
    );
  });

  it("is undefined when URL is unset, blank, unparseable or not http(s)", () => {
    for (const URL of [undefined, "", "  ", "not a url", "ftp://example.com"]) {
      expect(deployedSiteOrigin({ URL })).toBeUndefined();
    }
  });
});
