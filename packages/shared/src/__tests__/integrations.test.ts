import { describe, it, expect } from "vitest";
import { connectedProviders, findIntegration } from "../integrations";
import { INTEGRATION_PROVIDERS, isIntegrationProvider } from "../types";

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
