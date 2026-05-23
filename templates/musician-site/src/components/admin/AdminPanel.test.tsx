// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { AdminPanel } from "./AdminPanel";

describe("<AdminPanel> pending badge", () => {
  it("badges the title when hasPendingChanges is true", () => {
    render(
      <AdminPanel title="Site Settings" hasPendingChanges>
        <p>body</p>
      </AdminPanel>,
    );
    expect(screen.getByText("Unpublished")).toBeTruthy();
  });

  it("renders no badge when hasPendingChanges is false / omitted", () => {
    render(
      <AdminPanel title="Site Settings">
        <p>body</p>
      </AdminPanel>,
    );
    expect(screen.queryByText("Unpublished")).toBeNull();
  });
});
