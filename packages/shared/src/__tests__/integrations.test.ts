import { describe, it, expect } from "vitest";
import { connectedProviders, findIntegration, siteSetupIntegrationError } from "../integrations";
import { INTEGRATION_PROVIDERS, isIntegrationProvider, type IntegrationProvider } from "../types";

describe("isIntegrationProvider", () => {
  it.each(INTEGRATION_PROVIDERS)("accepts %s", (provider) => {
    expect(isIntegrationProvider(provider)).toBe(true);
  });

  it("rejects unknown, empty, and wrongly-cased values", () => {
    expect(isIntegrationProvider("gitlab")).toBe(false);
    expect(isIntegrationProvider("")).toBe(false);
    expect(isIntegrationProvider("GitHub")).toBe(false);
  });
});

describe("connectedProviders", () => {
  it("returns every known provider present in the rows", () => {
    const set = connectedProviders([{ provider: "github" }, { provider: "vercel" }, { provider: "resend" }]);
    expect([...set].sort()).toEqual(["github", "resend", "vercel"]);
  });

  it("ignores unknown provider values", () => {
    const set = connectedProviders([{ provider: "github" }, { provider: "gitlab" }]);
    expect([...set]).toEqual(["github"]);
  });

  it("dedupes repeated providers", () => {
    expect(connectedProviders([{ provider: "netlify" }, { provider: "netlify" }]).size).toBe(1);
  });

  it("returns an empty set for no rows", () => {
    expect(connectedProviders([]).size).toBe(0);
  });
});

describe("findIntegration", () => {
  const rows = [
    { provider: "github", providerAccountId: "1" },
    { provider: "netlify", providerAccountId: "2" },
  ];

  it("returns the row for a connected provider", () => {
    expect(findIntegration(rows, "netlify")).toEqual({ provider: "netlify", providerAccountId: "2" });
  });

  it("returns undefined when the provider is not connected", () => {
    expect(findIntegration(rows, "resend")).toBeUndefined();
  });

  it("returns undefined for no rows", () => {
    expect(findIntegration([], "github")).toBeUndefined();
  });
});

describe("siteSetupIntegrationError", () => {
  const set = (...providers: IntegrationProvider[]) => new Set<IntegrationProvider>(providers);

  it.each([
    ["Netlify", set("github", "netlify", "resend")],
    ["Vercel", set("github", "vercel", "resend")],
    ["both hosts", set("github", "netlify", "vercel", "resend")],
  ])("allows setup with GitHub, Resend and %s", (_label, connected) => {
    expect(siteSetupIntegrationError(connected, "creating")).toBeNull();
    expect(siteSetupIntegrationError(connected, "migrating")).toBeNull();
  });

  it("requires GitHub first", () => {
    expect(siteSetupIntegrationError(set("vercel", "resend"), "migrating")).toBe(
      "GitHub must be connected before migrating a site",
    );
    expect(siteSetupIntegrationError(set(), "creating")).toBe("GitHub must be connected before creating a site");
  });

  it("requires a deploy target", () => {
    expect(siteSetupIntegrationError(set("github", "resend"), "creating")).toBe(
      "A deploy target must be connected (Vercel or Netlify) before creating a site",
    );
  });

  it("requires Resend", () => {
    expect(siteSetupIntegrationError(set("github", "vercel"), "migrating")).toBe(
      "Resend must be connected (for magic-link sign-in on artist sites) before migrating a site",
    );
  });
});
