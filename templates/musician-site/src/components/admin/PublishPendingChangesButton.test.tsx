/**
 * The interactive `PublishPendingChangesButton` is driven by fetch
 * responses + a deploy-polling hook, so SSR snapshots of the button
 * itself can't reach the recoverable / terminal states we care about
 * here (concurrent-edit, stalled, error). Instead we test the pure
 * `StatusLine` sub-component, which takes the discriminated `Status`
 * as a prop — covering each kind asserts the copy the artist sees.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { __StatusLine as StatusLine } from "./PublishPendingChangesButton";

describe("PublishPendingChangesButton > StatusLine", () => {
  it("shows the concurrent-edit recovery copy when ADR-010 §6's code fires", () => {
    const html = renderToStaticMarkup(
      <StatusLine status={{ kind: "concurrent_edit" }} deployStatus={null} />,
    );
    expect(html).toContain("Someone else just saved");
    expect(html).toContain("reload");
    // role="status" (polite live region) — not role="alert", because
    // this isn't an error to escalate; it's actionable info. The
    // distinction lets assistive tech announce it without
    // interrupting the artist mid-edit.
    expect(html).toContain('role="status"');
    expect(html).not.toContain('role="alert"');
  });

  it("renders the generic error copy as role=alert for non-recoverable failures", () => {
    const html = renderToStaticMarkup(
      <StatusLine
        status={{ kind: "error", message: "Token broker returned 500" }}
        deployStatus={null}
      />,
    );
    expect(html).toContain("Token broker returned 500");
    expect(html).toContain('role="alert"');
  });

  it("returns null for in-progress kinds (no flicker between phases)", () => {
    expect(
      renderToStaticMarkup(
        <StatusLine status={{ kind: "idle" }} deployStatus={null} />,
      ),
    ).toBe("");
    expect(
      renderToStaticMarkup(
        <StatusLine status={{ kind: "publishing" }} deployStatus={null} />,
      ),
    ).toBe("");
    expect(
      renderToStaticMarkup(
        <StatusLine status={{ kind: "confirming" }} deployStatus={null} />,
      ),
    ).toBe("");
  });
});
