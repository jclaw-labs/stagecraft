// @vitest-environment jsdom

/**
 * Interaction tests for the create-collection form's client-side slug
 * validation. The point of the test is the PoC from the schema-core
 * split: `NewCollectionForm` imports `slugSchema` / `slugifyToCollectionSlug`
 * straight from `@/lib/collections/schema` and validates in the browser
 * with the same Zod schema the server route runs. An unslugifiable
 * plural name must surface a field-level error and gate the submit
 * button before any network round-trip.
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

import { NewCollectionForm } from "./NewCollectionForm";

// jest-dom isn't wired up in this repo, so we assert against native DOM
// properties (matching the plain-matcher style of the other tests).
const SLUG_ERROR = /couldn't make a URL slug/i;

function submitButton(): HTMLButtonElement {
  return screen.getByRole("button", {
    name: /create collection/i,
  }) as HTMLButtonElement;
}

describe("<NewCollectionForm /> client-side slug validation", () => {
  it("surfaces a field-level error and disables submit for an unslugifiable plural name", async () => {
    const user = userEvent.setup();
    render(<NewCollectionForm />);

    // All-punctuation slugifies to "" — fails slugSchema.
    await user.type(screen.getByLabelText("Plural name"), "!!!");
    await user.type(screen.getByLabelText("Singular name"), "Thing");

    expect(screen.getByRole("alert").textContent).toMatch(SLUG_ERROR);
    expect(submitButton().disabled).toBe(true);
  });

  it("clears the error and enables submit once the plural name yields a valid slug", async () => {
    const user = userEvent.setup();
    render(<NewCollectionForm />);

    const plural = screen.getByLabelText("Plural name");
    await user.type(plural, "!!!");
    expect(screen.getByRole("alert").textContent).toMatch(SLUG_ERROR);

    await user.clear(plural);
    await user.type(plural, "Press quotes");
    await user.type(screen.getByLabelText("Singular name"), "Press quote");

    expect(screen.queryByRole("alert")).toBeNull();
    expect(submitButton().disabled).toBe(false);
  });

  it("does not shout an error on first paint before the artist types", () => {
    render(<NewCollectionForm />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(submitButton().disabled).toBe(true);
  });
});
