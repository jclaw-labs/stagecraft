import { expect, test } from "@playwright/test";

import { seedCompletedSite } from "./setup/seed";

/**
 * Admin responses must not carry the public layout, and both 404s must
 * keep their own look and status (#390).
 *
 * Next puts the root not-found boundary into the RSC payload of every
 * route, so a public-themed `app/not-found.tsx` would make every admin
 * response read the site config and ship the artist's theme in a
 * `<script>` payload nobody sees. A component test can't see that, so
 * this asks the running server for the HTML and the RSC payload.
 */

const TEST_ARTIST_NAME = "Not Found Artist";

/** Marker class on the public layout's wrapper. */
const PUBLIC_LAYOUT_MARKER = "stagecraft-site";

/** First declaration `AppearanceStyles` writes into its inline `<style>`. */
const PUBLIC_THEME_MARKER = "--color-background:";

const RSC_HEADERS = { RSC: "1" };

test.describe("not-found boundaries", () => {
  test.beforeEach(async () => {
    await seedCompletedSite(TEST_ARTIST_NAME);
  });

  // The root boundary rides along on every route alike, so the sign-in
  // page and one 404 cover it without compiling the heavier admin pages.
  for (const url of ["/admin/login", "/admin/nope"]) {
    test(`${url} carries no public layout in its HTML or RSC payload`, async ({ request }) => {
      for (const headers of [{}, RSC_HEADERS]) {
        const res = await request.get(url, { headers, maxRedirects: 0 });
        const body = await res.text();
        expect(body).not.toContain(PUBLIC_LAYOUT_MARKER);
        expect(body).not.toContain(PUBLIC_THEME_MARKER);
      }
    });
  }

  test("an unknown admin URL gets the admin 404", async ({ request }) => {
    const res = await request.get("/admin/nope");
    expect(res.status()).toBe(404);
    expect(await res.text()).toContain("data-admin-not-found");
  });

  test("an unknown public URL gets the themed 404 with the artist's title", async ({
    request,
  }) => {
    const res = await request.get("/no-such-page");
    expect(res.status()).toBe(404);
    const html = await res.text();
    expect(html).toContain(PUBLIC_LAYOUT_MARKER);
    expect(html).toContain(PUBLIC_THEME_MARKER);
    expect(html).toContain("This page could not be found.");
    expect(html).toContain(`<title>${TEST_ARTIST_NAME} — Official Website</title>`);
  });
});
