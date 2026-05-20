import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));

import { DangerZone } from "./DangerZone";

function render(props: Partial<React.ComponentProps<typeof DangerZone>> = {}): string {
  return renderToStaticMarkup(<DangerZone artistName="Nova Reyes" {...props} />);
}

describe("<DangerZone /> initial (idle) render", () => {
  it("renders the Danger zone heading and a single Reset trigger", () => {
    const html = render();
    expect(html).toContain("Danger zone");
    expect(html).toContain("Reset site to first-run state");
    // Only one button at idle — clicking it advances to the warned stage.
    expect(html).toMatch(/Reset site/);
  });

  it("does NOT show the deletion-list checklist in the idle stage", () => {
    const html = render();
    // Warned-stage copy starts with "Are you sure?" — should be absent at idle.
    expect(html).not.toContain("Are you sure?");
    // Final-stage copy should also be absent until both prior confirms happen.
    expect(html).not.toContain("Final confirmation");
  });

  it("does NOT expose the typed-confirmation inputs at the idle stage", () => {
    const html = render();
    expect(html).not.toContain("delete my content");
    // The "Type your artist name" field is only on the final stage.
    expect(html).not.toMatch(/Type your artist name/);
  });

  it("warns explicitly about the destructive nature of the reset", () => {
    const html = render();
    // Reset description names what gets deleted so the artist can decide.
    expect(html).toMatch(/Deletes every page/);
  });
});
