// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { GitHubUnavailableBanner } from "./GitHubUnavailableBanner";

describe("<GitHubUnavailableBanner>", () => {
  it("renders a status role with the unavailable + read-only messaging", () => {
    render(<GitHubUnavailableBanner />);
    const banner = screen.getByRole("status");
    expect(banner.textContent).toContain("GitHub is unavailable");
    expect(banner.textContent).toContain("last published version");
    expect(banner.textContent).toContain("won’t go through");
  });
});
