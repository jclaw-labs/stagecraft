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

import {
  __StatusLine as StatusLine,
  __statusForFetchResponse as statusForFetchResponse,
} from "./PublishPendingChangesButton";

/** Stand-in for `Response` — only `ok` and `status` are read. */
function fakeRes(ok: boolean, status: number): Response {
  return { ok, status } as Response;
}

const FIXED_NOW = 1_700_000_000_000;

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

// ---------------------------------------------------------------------------
// statusForFetchResponse — pure dispatch from fetch response → Status.
// Extracted from `fire()` so the `code === "concurrent-edit"` branch is
// directly testable without a fetch mock; in particular, asserting that
// renaming the concurrent-edit code (or the route emitting a different
// one) doesn't silently fall through to the generic error toast.
// ---------------------------------------------------------------------------

describe("PublishPendingChangesButton > statusForFetchResponse", () => {
  it("dispatches code: concurrent-edit to the concurrent_edit kind", () => {
    const body = {
      ok: false as const,
      code: "concurrent-edit" as const,
      error: "Concurrent edit on heads/draft: 3 attempts exhausted.",
    };
    expect(statusForFetchResponse(fakeRes(false, 409), body, FIXED_NOW)).toEqual({
      kind: "concurrent_edit",
    });
  });

  it("falls through to the generic error kind for unrecognised failure codes", () => {
    const body = {
      ok: false as const,
      code: "github-failed" as const,
      error: "boom",
    };
    expect(statusForFetchResponse(fakeRes(false, 500), body, FIXED_NOW)).toEqual({
      kind: "error",
      message: "boom",
    });
  });

  it("uses an HTTP-status fallback message when the body has no error string", () => {
    expect(
      statusForFetchResponse(fakeRes(false, 500), null, FIXED_NOW),
    ).toEqual({ kind: "error", message: "Publish failed (HTTP 500)" });
  });

  it("returns noop when the server reports alreadyInSync", () => {
    const body = {
      ok: true as const,
      commitSha: "sha",
      mode: "github",
      alreadyInSync: true,
    };
    expect(statusForFetchResponse(fakeRes(true, 200), body, FIXED_NOW)).toEqual({
      kind: "noop",
    });
  });

  it("treats dev fallback (mode=local) as immediately live (no deploy to poll)", () => {
    const body = {
      ok: true as const,
      commitSha: null,
      mode: "local",
      alreadyInSync: false,
    };
    expect(statusForFetchResponse(fakeRes(true, 200), body, FIXED_NOW)).toEqual({
      kind: "live",
    });
  });

  it("enters in_flight with the supplied `now` timestamp on a real prod publish", () => {
    const body = {
      ok: true as const,
      commitSha: "abc",
      mode: "github",
      alreadyInSync: false,
    };
    expect(statusForFetchResponse(fakeRes(true, 200), body, FIXED_NOW)).toEqual({
      kind: "in_flight",
      publishedAt: FIXED_NOW,
    });
  });
});
