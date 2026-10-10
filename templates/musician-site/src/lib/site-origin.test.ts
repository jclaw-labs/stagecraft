import { describe, expect, it } from "vitest";

import { deployedSiteOrigin } from "./site-origin";

const NETLIFY = { NETLIFY: "true" };

describe("deployedSiteOrigin", () => {
  it("reads the site's origin from Netlify's URL", () => {
    expect(deployedSiteOrigin({ ...NETLIFY, URL: "https://juneharlow.com" })?.href).toBe(
      "https://juneharlow.com/",
    );
  });

  it("drops any path, so root-relative image URLs resolve from the root", () => {
    expect(
      deployedSiteOrigin({ ...NETLIFY, URL: "https://juneharlow.netlify.app/sub/" })?.href,
    ).toBe("https://juneharlow.netlify.app/");
  });

  it("uses the deploy's own address on a deploy preview or branch deploy", () => {
    for (const CONTEXT of ["deploy-preview", "branch-deploy"]) {
      const env = {
        ...NETLIFY,
        CONTEXT,
        URL: "https://juneharlow.com",
        DEPLOY_PRIME_URL: "https://deploy-preview-12--juneharlow.netlify.app",
      };
      expect(deployedSiteOrigin(env)?.href).toBe("https://deploy-preview-12--juneharlow.netlify.app/");
    }
  });

  it("uses the main address in production, and when a preview has no DEPLOY_PRIME_URL", () => {
    const base = { ...NETLIFY, URL: "https://juneharlow.com" };
    const prod = { ...base, CONTEXT: "production", DEPLOY_PRIME_URL: "https://main--juneharlow.netlify.app" };
    for (const env of [prod, { ...base, CONTEXT: "deploy-preview" }]) {
      expect(deployedSiteOrigin(env)?.href).toBe("https://juneharlow.com/");
    }
  });

  it("ignores URL off Netlify, where the name can mean anything", () => {
    expect(deployedSiteOrigin({ URL: "https://juneharlow.com" })).toBeUndefined();
    expect(deployedSiteOrigin({ NETLIFY: "false", URL: "https://juneharlow.com" })).toBeUndefined();
  });

  it("is undefined when URL is unset, blank, unparseable or not http(s)", () => {
    for (const URL of [undefined, "", "  ", "not a url", "ftp://example.com"]) {
      expect(deployedSiteOrigin({ ...NETLIFY, URL })).toBeUndefined();
    }
  });
});
