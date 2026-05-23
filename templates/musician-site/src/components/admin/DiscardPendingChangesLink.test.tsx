import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { DiscardPendingChangesLink } from "./DiscardPendingChangesLink";

describe("DiscardPendingChangesLink > isDegraded", () => {
  it("disables the discard link while GitHub is unreachable", () => {
    const html = renderToStaticMarkup(<DiscardPendingChangesLink isDegraded />);
    expect(html).toContain("disabled");
    expect(html).toContain("Unavailable while GitHub is unreachable");
  });

  it("renders an enabled link normally", () => {
    const html = renderToStaticMarkup(<DiscardPendingChangesLink />);
    expect(html).not.toContain("Unavailable while GitHub is unreachable");
    expect(html).not.toContain("disabled");
  });
});
