/**
 * Unknown `/admin/*` URLs land on this catch-all, which hands off to
 * `admin/not-found.tsx` rather than the artist-themed root 404.
 */

import { describe, expect, it } from "vitest";

import AdminUnknownRoute from "./page";

describe("admin unknown-route catch-all", () => {
  it("throws Next's 404 signal", () => {
    let thrown: unknown;
    try {
      AdminUnknownRoute();
    } catch (error) {
      thrown = error;
    }
    // `notFound()` throws an error whose digest ends in the status code.
    expect((thrown as { digest?: string } | undefined)?.digest).toMatch(/;404$/);
  });
});
