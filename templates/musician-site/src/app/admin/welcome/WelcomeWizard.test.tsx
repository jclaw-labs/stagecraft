import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// The wizard pushes to /admin/pages on completion via Next's router;
// stub it so the static render doesn't crash.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));

import { DEFAULT_THEME_ID, THEME_IDS, THEME_PRESETS } from "@/lib/theme-presets";
import { StepContent, WelcomeWizard } from "./WelcomeWizard";
import {
  WELCOME_STEPS,
  type WelcomeFormValues,
  type WelcomeStep,
} from "./welcome-steps";

// A named preset that isn't the default, for the "a theme is selected"
// cases — stays valid as the preset library changes.
const NAMED_PRESET = THEME_IDS.find((id) => id !== DEFAULT_THEME_ID)!;

function startValues(overrides: Partial<WelcomeFormValues> = {}): WelcomeFormValues {
  return {
    artistName: "Nova",
    start: DEFAULT_THEME_ID,
    primaryColor: "#0f3460",
    wordmark: null,
    firstPageTitle: "Home",
    ...overrides,
  };
}

function render(props: Partial<React.ComponentProps<typeof WelcomeWizard>> = {}): string {
  return renderToStaticMarkup(
    <WelcomeWizard
      email="artist@example.com"
      initialArtistName=""
      initialPrimaryColor="#0f3460"
      {...props}
    />,
  );
}

describe("WELCOME_STEPS contract", () => {
  it("walks name → start → wordmark → firstPage in order", () => {
    expect(WELCOME_STEPS).toEqual(["name", "start", "wordmark", "firstPage"]);
  });

  it("never repeats a step id", () => {
    const set = new Set<WelcomeStep>(WELCOME_STEPS);
    expect(set.size).toBe(WELCOME_STEPS.length);
  });
});

describe("<WelcomeWizard /> initial render (step 1)", () => {
  it("renders the welcome title and step indicator", () => {
    const html = render();
    // &rsquo; renders as the curly apostrophe (’).
    expect(html).toContain("Let’s set up your site");
    expect(html).toMatch(/Step\s+1\s+\/\s+4/);
  });

  it("shows the signed-in email so the artist knows who they are", () => {
    const html = render({ email: "nova@example.com" });
    expect(html).toContain("nova@example.com");
  });

  it("omits the email line when no email is known (dev fallback)", () => {
    const html = render({ email: "" });
    expect(html).not.toMatch(/Signed in as/);
  });

  it("renders the artist-name TextField on the first step", () => {
    const html = render();
    // The Field's label text is hard-rendered next to the input.
    expect(html).toContain("Artist name");
    // The placeholder hints the artist on what to type.
    expect(html).toContain("Nova Reyes");
  });

  it("disables the Next button when artist name is blank", () => {
    const html = render({ initialArtistName: "" });
    // Form-submit button is the primary action; on step 1 with empty
    // name it's disabled (canAdvance=false).
    expect(html).toMatch(/<button[^>]+type="submit"[^>]+disabled/);
  });

  it("enables the Next button when an initial artist name is prefilled", () => {
    const html = render({ initialArtistName: "Nova" });
    // The submit button doesn't have a `disabled` attribute.
    const buttonMatch = html.match(/<button[^>]+type="submit"[^>]*>/);
    expect(buttonMatch).not.toBeNull();
    expect(buttonMatch![0]).not.toContain("disabled");
  });

  it("does NOT show a Back button on the first step", () => {
    const html = render();
    // Only the Next button — no Back.
    expect(html).not.toMatch(/>Back</);
  });

  it("does NOT show the final 'Set up my site' label on step 1", () => {
    const html = render();
    expect(html).not.toMatch(/Set up my site/);
    expect(html).toMatch(/Next/);
  });
});

describe('<StepContent step="start" />', () => {
  it("renders a card for every theme plus custom + empty", () => {
    const html = renderToStaticMarkup(
      <StepContent step="start" values={startValues()} setField={() => {}} />,
    );
    expect(html).toContain("Choose a starting point");
    // A card per preset (by display name), derived from the preset library.
    for (const id of THEME_IDS) {
      expect(html).toContain(THEME_PRESETS[id].name);
    }
    expect(html).toContain("Custom colour");
    expect(html).toContain("Start empty");
    // One radio per theme plus the custom + empty escape hatches.
    expect(html.match(/role="radio"/g) ?? []).toHaveLength(THEME_IDS.length + 2);
  });

  it("marks exactly the selected start as aria-checked", () => {
    const html = renderToStaticMarkup(
      <StepContent step="start" values={startValues({ start: NAMED_PRESET })} setField={() => {}} />,
    );
    expect(html.match(/aria-checked="true"/g) ?? []).toHaveLength(1);
  });

  it("reveals the colour picker only on the custom path", () => {
    const preset = renderToStaticMarkup(
      <StepContent step="start" values={startValues({ start: DEFAULT_THEME_ID })} setField={() => {}} />,
    );
    expect(preset).not.toContain("welcome-primaryColor");

    const custom = renderToStaticMarkup(
      <StepContent step="start" values={startValues({ start: "custom" })} setField={() => {}} />,
    );
    expect(custom).toContain("welcome-primaryColor");
  });
});
