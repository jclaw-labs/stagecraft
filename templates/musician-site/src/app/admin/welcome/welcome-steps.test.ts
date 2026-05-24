import { describe, expect, it } from "vitest";

import { DEFAULT_THEME_ID, THEME_IDS } from "@/lib/theme-presets";
import {
  buildWelcomePayload,
  START_CHOICES,
  WELCOME_STEPS,
  type WelcomeFormValues,
} from "./welcome-steps";

// A named preset that isn't the default — keeps the "named preset" case
// distinct from the "empty → default theme" case below, and stays valid
// as the preset library changes.
const NAMED_PRESET = THEME_IDS.find((id) => id !== DEFAULT_THEME_ID)!;

function values(overrides: Partial<WelcomeFormValues> = {}): WelcomeFormValues {
  return {
    artistName: "Nova Reyes",
    start: DEFAULT_THEME_ID,
    primaryColor: "#0f3460",
    wordmark: null,
    firstPageTitle: "Home",
    ...overrides,
  };
}

describe("WELCOME_STEPS", () => {
  it("walks name → start → wordmark → firstPage", () => {
    expect(WELCOME_STEPS).toEqual(["name", "start", "wordmark", "firstPage"]);
  });
});

describe("START_CHOICES", () => {
  it("offers every theme plus custom + empty", () => {
    expect(START_CHOICES).toEqual([...THEME_IDS, "custom", "empty"]);
  });
});

describe("buildWelcomePayload", () => {
  it("a named preset sends theme + seedContent:true", () => {
    const body = buildWelcomePayload(values({ start: NAMED_PRESET }));
    expect(body.theme).toBe(NAMED_PRESET);
    expect(body.seedContent).toBe(true);
  });

  it("custom omits theme (accent-swap path) and seeds content", () => {
    const body = buildWelcomePayload(values({ start: "custom", primaryColor: "#aa00ff" }));
    expect(body.theme).toBeUndefined();
    expect(body.seedContent).toBe(true);
    expect(body.primaryColor).toBe("#aa00ff");
  });

  it("empty applies the default theme with no seeded content", () => {
    const body = buildWelcomePayload(values({ start: "empty" }));
    expect(body.theme).toBe(DEFAULT_THEME_ID);
    expect(body.seedContent).toBe(false);
  });

  it("trims the free-text fields", () => {
    const body = buildWelcomePayload(
      values({ artistName: "  Nova  ", firstPageTitle: "  Home  ", primaryColor: " #fff " }),
    );
    expect(body.artistName).toBe("Nova");
    expect(body.firstPageTitle).toBe("Home");
    expect(body.primaryColor).toBe("#fff");
  });

  it("passes the wordmark through untouched", () => {
    const wordmark = { id: "x", alt: "logo" } as unknown as WelcomeFormValues["wordmark"];
    const body = buildWelcomePayload(values({ wordmark }));
    expect(body.wordmark).toBe(wordmark);
  });
});
