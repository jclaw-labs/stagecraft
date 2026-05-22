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
  type NewsletterService,
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

  it("renders a required email input with the service-correct field name", () => {
    // Each provider's form handler reads a specific field name.
    // POSTing the wrong name silently succeeds (no-cors response
    // is opaque) but the subscriber never lands in the list —
    // exactly the kind of failure mode the artist won't notice
    // until checking their dashboard. Lock the mapping here.
    const cases: Array<[NewsletterService, string]> = [
      ["mailchimp", "EMAIL"],
      ["convertkit", "email_address"],
      ["buttondown", "email"],
      ["generic", "email"],
    ];
    for (const [service, expectedName] of cases) {
      const html = renderForm({ service });
      expect(html, `${service} should POST as name="${expectedName}"`).toMatch(
        new RegExp(`<input[^>]+name="${expectedName}"`),
      );
    }
    // type / required don't vary by service.
    const html = renderForm();
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

  it("emits Mailchimp's audience-suffixed honeypot from the actionUrl when service=mailchimp", () => {
    // Mailchimp's real bot trap is `b_<u>_<id>` where the suffix
    // comes from the `?u=USER_ID&id=LIST_ID` query params. Earlier
    // impl emitted a generic `b_subscribe_honeypot` placeholder
    // that Mailchimp ignored at the provider end — zero protection.
    // Parsing the URL gives the correct field name so Mailchimp's
    // own bot defense fires on a non-empty value.
    const html = renderForm({
      service: "mailchimp",
      actionUrl: "https://example.us1.list-manage.com/subscribe/post?u=abc123&id=xyz789",
    });
    expect(html).toMatch(/name="b_abc123_xyz789"/);
  });

  it("omits the b_* honeypot entirely when the actionUrl doesn't parse", () => {
    // Custom-domain or partially-typed actionUrl: prefer no field
    // over the wrong field. The universal `_gotcha` honeypot above
    // is the client-side fallback.
    const html = renderForm({
      service: "mailchimp",
      actionUrl: "https://artist.example/subscribe",
    });
    expect(html).not.toMatch(/name="b_/);
  });

  it("omits the b_* honeypot for non-Mailchimp services", () => {
    for (const service of ["convertkit", "buttondown", "generic"] as const) {
      const html = renderForm({ service });
      expect(html).not.toMatch(/name="b_/);
    }
  });
});

describe("NewsletterSignup — optional name field", () => {
  it("omits the name field by default (email-only)", () => {
    // Default off — most artist newsletters collect email-only.
    // Without explicit `hasNameField`, the form has only the email
    // input + honeypots.
    const html = renderForm();
    expect(html).not.toMatch(/name="FNAME"/);
    expect(html).not.toMatch(/name="fields\[first_name\]"/);
    expect(html).not.toMatch(/autocomplete="given-name"/);
  });

  it("renders the name field with Mailchimp's FNAME merge attribute", () => {
    const html = renderForm({ service: "mailchimp", hasNameField: true });
    expect(html).toMatch(/name="FNAME"/);
    expect(html).toMatch(/autocomplete="given-name"/i);
  });

  it("uses the ConvertKit nested-fields attribute name", () => {
    const html = renderForm({
      service: "convertkit",
      actionUrl: "https://app.convertkit.com/forms/12345/subscriptions",
      hasNameField: true,
    });
    expect(html).toMatch(/name="fields\[first_name\]"/);
  });

  it("uses Buttondown's metadata bucket attribute name", () => {
    const html = renderForm({
      service: "buttondown",
      actionUrl: "https://buttondown.email/api/emails/embed-subscribe/artist",
      hasNameField: true,
    });
    expect(html).toMatch(/name="metadata\[name\]"/);
  });

  it("uses generic `name` for the generic service", () => {
    const html = renderForm({
      service: "generic",
      actionUrl: "https://artist.example/subscribe",
      hasNameField: true,
    });
    expect(html).toMatch(/name="name"/);
  });

  it("honours a custom nameLabel via the field label", () => {
    const html = renderForm({
      service: "mailchimp",
      hasNameField: true,
      nameLabel: "Your name",
    });
    expect(html).toContain("Your name");
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
