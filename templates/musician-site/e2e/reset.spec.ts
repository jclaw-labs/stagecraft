import { expect, test } from "@playwright/test";

import { seedCompletedSite } from "./setup/seed";

const TEST_ARTIST_NAME = "Reset Test Artist";

/**
 * End-to-end coverage for the destructive Reset flow in
 * Site Settings → Danger zone.
 *
 * The three-stage confirmation (idle → warned → confirming) and the
 * typed-name + literal-phrase gating live across the UI and the
 * server route; this spec confirms both halves cooperate. We seed
 * a "completed welcome" state so we can navigate to /admin/settings
 * directly and exercise the danger zone.
 */
test.describe("danger-zone reset", () => {
  test.beforeEach(async () => {
    await seedCompletedSite(TEST_ARTIST_NAME);
  });

  test("walks all three confirmation stages and lands back at /admin/welcome", async ({
    page,
  }) => {
    await page.goto("/admin/settings");
    await expect(page.getByRole("heading", { name: "Site Settings" })).toBeVisible();

    // Idle stage — initial trigger.
    const dangerHeading = page.getByText("Reset site to first-run state");
    await expect(dangerHeading).toBeVisible();
    await page.getByRole("button", { name: /^Reset site…?$/ }).click();

    // Warned stage — explainer checklist + "I understand" button.
    await expect(page.getByText("Are you sure?")).toBeVisible();
    await expect(page.getByText(/Every page on your site will be deleted/)).toBeVisible();

    const understandButton = page.getByRole("button", {
      name: /I understand, continue/i,
    });
    await expect(understandButton).toBeVisible();
    await understandButton.click();

    // Confirming stage — both inputs visible, reset button disabled
    // until both match.
    await expect(page.getByText("Final confirmation")).toBeVisible();
    const resetButton = page.getByRole("button", { name: /^Reset site$/ });
    await expect(resetButton).toBeDisabled();

    // Typing only the artist name shouldn't enable the button.
    await page.getByLabel(/Type your artist name/).fill(TEST_ARTIST_NAME);
    await expect(resetButton).toBeDisabled();

    // Typing only the phrase shouldn't either (clear name first).
    await page.getByLabel(/Type your artist name/).fill("");
    await page.getByLabel(/Type the phrase/).fill("delete my content");
    await expect(resetButton).toBeDisabled();

    // Both match → button enables.
    await page.getByLabel(/Type your artist name/).fill(TEST_ARTIST_NAME);
    await expect(resetButton).toBeEnabled();

    await resetButton.click();

    // After reset: /admin → /admin/welcome (flag is now false).
    await expect(page).toHaveURL(/\/admin\/welcome$/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: /set up your site/i })).toBeVisible();

    // The site singleton was actually wiped, not just the flag flipped:
    // step 1's artist-name field pre-fills empty (welcome page.tsx
    // blanks the field when site.artistName matches the DEFAULT
    // sentinel, which is what the reset route writes back).
    await expect(page.getByLabel("Artist name")).toHaveValue("");
  });

  test("Cancel from the warned stage returns to idle without changing state", async ({
    page,
  }) => {
    await page.goto("/admin/settings");
    await page.getByRole("button", { name: /^Reset site…?$/ }).click();
    await expect(page.getByText("Are you sure?")).toBeVisible();

    await page.getByRole("button", { name: "Cancel" }).click();

    // Back to idle — the "Reset site…" trigger is visible again.
    await expect(page.getByRole("button", { name: /^Reset site…?$/ })).toBeVisible();
    await expect(page.getByText("Are you sure?")).not.toBeVisible();
  });
});
