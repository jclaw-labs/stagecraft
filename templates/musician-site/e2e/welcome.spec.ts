import { expect, test } from "@playwright/test";

import { seedCompletedSite, wipeContentDir } from "./setup/seed";

/**
 * End-to-end coverage for the first-run welcome wizard.
 *
 * Drives the four-step flow from a fresh-site state (no completed
 * flag, no pages) through to the seeded `/admin/pages` view. The
 * wizard's individual steps are covered by component tests; this
 * spec is the integration glue — it asserts that the form submit
 * actually writes through the route handler, sets the flag, and
 * triggers the redirect back into steady-state.
 */
test.describe("welcome wizard", () => {
  test.beforeEach(async () => {
    // Wipe the e2e content dir so the wizard's first-run check
    // (`hasCompletedFirstRun=false` via missing site singleton)
    // sends us to /admin/welcome instead of /admin/pages.
    await wipeContentDir();
  });

  test("completes the four-step flow and lands on /admin/pages with seed content", async ({
    page,
  }) => {
    // `/admin` redirects to `/admin/welcome` when first-run is true.
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin\/welcome$/);
    await expect(page.getByRole("heading", { name: /set up your site/i })).toBeVisible();
    await expect(page.getByText(/Step\s+1\s+\/\s+4/)).toBeVisible();

    // Step 1 — artist name. Next stays disabled until the field is
    // non-empty, then advances to step 2.
    // `exact: true` rules out Next.js 15.5+'s dev-tools button, which
    // carries `aria-label="Open Next.js Dev Tools"` and otherwise
    // matches the substring `name: "Next"`.
    const nextButton = page.getByRole("button", { name: "Next", exact: true });
    await expect(nextButton).toBeDisabled();
    await page.getByLabel("Artist name").fill("Test Artist");
    await expect(nextButton).toBeEnabled();
    await nextButton.click();

    // Step 2 — starting point. A theme (Classic) is preselected so Next
    // is already enabled; click Midnight to exercise the radio cards.
    await expect(page.getByText(/Step\s+2\s+\/\s+4/)).toBeVisible();
    await expect(page.getByRole("heading", { name: /starting point/i })).toBeVisible();
    await page.getByRole("radio", { name: /Midnight/i }).click();
    await page.getByRole("button", { name: "Next", exact: true }).click();

    // Step 3 — wordmark. Optional; Next is enabled without an upload.
    await expect(page.getByText(/Step\s+3\s+\/\s+4/)).toBeVisible();
    await expect(page.getByRole("heading", { name: /wordmark/i })).toBeVisible();
    await page.getByRole("button", { name: "Next", exact: true }).click();

    // Step 4 — first page title. Pre-fills with "Home"; submit is
    // labelled "Set up my site" on the final step.
    await expect(page.getByText(/Step\s+4\s+\/\s+4/)).toBeVisible();
    await expect(page.getByLabel("First page title")).toHaveValue("Home");

    const submitButton = page.getByRole("button", { name: /set up my site/i });
    await expect(submitButton).toBeEnabled();
    await submitButton.click();

    // POST /api/welcome/complete + client-side router.replace() →
    // we land on /admin/pages with the seeded Home page visible.
    await expect(page).toHaveURL(/\/admin\/pages$/);
    // PagesPanel renders TWO links per row both pointing at
    // /admin/pages/<slug>: the page title and the row's Edit button.
    // Either one being visible proves the seeded row landed; pick the
    // first match to satisfy Playwright's strict-mode locator.
    await expect(
      page.locator('a[href="/admin/pages/home"]').first(),
    ).toBeVisible();
  });

  test("a completed site bypasses the wizard on /admin", async ({ page }) => {
    // Seed with hasCompletedFirstRun=true before navigating; /admin
    // should jump straight to /admin/pages.
    await seedCompletedSite("Returning Artist");

    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin\/pages$/);

    // Direct visit to /admin/welcome also bounces away.
    await page.goto("/admin/welcome");
    await expect(page).toHaveURL(/\/admin\/pages$/);
  });
});
