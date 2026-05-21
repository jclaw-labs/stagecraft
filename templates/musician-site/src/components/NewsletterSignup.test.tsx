/**
 * SSR snapshot coverage for `NewsletterSignup`. Submission behaviour
 * (no-cors fetch, honeypot client-side check, optimistic success) is
 * a `"use client"` flow that needs interactivity — not exercised
 * here; SSR markup is what every visitor sees on first paint, and
 * locking it down catches the form-structure regressions
 * (missing fields, wrong name attributes, missing honeypots).
 *
 * Same renderToStaticMarkup pattern other public-render components
 * (Image, AppearanceStyles, Footer) use.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import {
  NEWSLETTER_SERVICES,
  NEWSLETTER_SERVICE_LABELS,
  NewsletterSignup,
} from "./NewsletterSignup";

function renderForm(
  overrides: Partial<Parameters<typeof NewsletterSignup>[0]> = {},
): string {
  return renderToStaticMarkup(
    <NewsletterSignup
      service="mailchimp"
      actionUrl="https://example.us1.list-manage.com/subscribe/post"
      {...overrides}
    />,
  );
}

describe("NewsletterSignup — service catalogue", () => {
  it("exposes the four legacy-parity services", () => {
    // Same names + ordering the legacy template's
    // `NEWSLETTER_SERVICES` carried. Generic = "I'll post the
    // actionUrl as-is" escape hatch for self-hosted lists.
    expect([...NEWSLETTER_SERVICES]).toEqual([
      "mailchimp",
      "convertkit",
      "buttondown",
      "generic",
    ]);
  });

  it("has a human-readable label for every service", () => {
    for (const service of NEWSLETTER_SERVICES) {
      expect(NEWSLETTER_SERVICE_LABELS[service]).toBeTruthy();
    }
  });
});

describe("NewsletterSignup — form structure", () => {
  it("renders <form method=post> pointed at the artist's actionUrl", () => {
    const html = renderForm({ actionUrl: "https://buttondown.email/api/whatever" });
    // Method + action — the native form fallback (when JS is off)
    // still POSTs to the provider; the React handler intercepts
    // when JS is on. Same legacy pattern.
    expect(html).toMatch(/<form[^>]+method="post"/);
    expect(html).toContain('action="https://buttondown.email/api/whatever"');
  });

  it("renders an `EMAIL`-named required email input", () => {
    // `EMAIL` (uppercase) is Mailchimp's expected merge-field name
    // for the subscriber address. ConvertKit / Buttondown accept it
    // too. Using uppercase keeps Mailchimp working without per-
    // service field-name dispatch.
    const html = renderForm();
    expect(html).toMatch(/<input[^>]+name="EMAIL"/);
    expect(html).toMatch(/<input[^>]+type="email"/);
    expect(html).toMatch(/<input[^>]+required/);
  });

  it("renders a submit button with the configured label", () => {
    const html = renderForm({ submitLabel: "Get the newsletter" });
    expect(html).toMatch(/<button[^>]+type="submit"[^>]*>Get the newsletter/);
  });

  it("renders the title heading when set, omits it when empty", () => {
    expect(renderForm({ title: "Stay close" })).toContain("Stay close");
    expect(renderForm({ title: "" })).not.toMatch(/<h3/);
  });

  it("uses the configured emailLabel as the (visually-hidden) accessible name", () => {
    const html = renderForm({ emailLabel: "Your email address" });
    // Label is screen-reader-only; the placeholder is the visible
    // hint. Lock the label text + the htmlFor relationship.
    expect(html).toContain("Your email address");
    expect(html).toMatch(/<label[^>]+for="[^"]+"/);
  });
});

describe("NewsletterSignup — anti-spam honeypots", () => {
  it("renders the universal `_gotcha` honeypot, screen-reader-only and untabbable", () => {
    const html = renderForm();
    // The honeypot pattern: present in the DOM (so bots that auto-
    // fill all inputs trip it) but invisible to humans and skipped
    // by keyboard tabbing.
    expect(html).toMatch(/<input[^>]+name="_gotcha"/);
    expect(html).toMatch(/<input[^>]+tabindex="-1"/i);
    expect(html).toMatch(/<input[^>]+autocomplete="off"/i);
    // Visually-hidden wrapper (off-screen positioning, not display:none —
    // accessibility-tree presence is what trips well-behaved bots).
    expect(html).toContain('aria-hidden="true"');
  });

  it("emits Mailchimp's `b_<placeholder>` honeypot for service=mailchimp", () => {
    // Mailchimp's real bot-trap is `b_<list>_<id>`; we emit a
    // generic placeholder without parsing actionUrl. Same best-
    // effort as the legacy template.
    const html = renderForm({ service: "mailchimp" });
    expect(html).toMatch(/name="b_subscribe_honeypot"/);
  });

  it("omits the b_* honeypot for non-Mailchimp services", () => {
    for (const service of ["convertkit", "buttondown", "generic"] as const) {
      const html = renderForm({ service });
      expect(html).not.toMatch(/name="b_subscribe_honeypot"/);
    }
  });
});

describe("NewsletterSignup — placeholder when actionUrl is empty", () => {
  it("shows an admin-visible hint instead of a non-functional form", () => {
    // Editor-time experience: dragging the block onto a page
    // before configuring actionUrl shouldn't render a submit
    // button that POSTs to "". The placeholder card tells the
    // artist what's missing.
    const html = renderForm({ actionUrl: "" });
    expect(html).not.toMatch(/<form/);
    expect(html).toMatch(/submission URL/i);
  });
});
