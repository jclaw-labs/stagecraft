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

describe("NewsletterSignup — additional fields", () => {
  it("renders no additional fields by default (email-only baseline)", () => {
    const html = renderForm();
    // Only the email input + honeypots; no extra named inputs.
    expect(html).not.toMatch(/name="phone"/);
  });

  it("renders each additional field as a labelled input with its raw name + type", () => {
    const html = renderForm({
      additionalFields: [
        { label: "Phone", name: "PHONE", type: "tel" },
        { label: "Country", name: "mmerge3", type: "text" },
      ],
    });
    // Raw provider name attributes are emitted verbatim.
    expect(html).toMatch(/<input[^>]+name="PHONE"[^>]*type="tel"|<input[^>]+type="tel"[^>]*name="PHONE"/);
    expect(html).toMatch(/name="mmerge3"/);
    // Labels are present (screen-reader association).
    expect(html).toContain("Phone");
    expect(html).toContain("Country");
  });

  it("derives a sensible autocomplete token from the input type", () => {
    const html = renderForm({
      additionalFields: [
        { label: "Phone", name: "PHONE", type: "tel" },
        { label: "Website", name: "URL", type: "url" },
      ],
    });
    expect(html).toMatch(/autocomplete="tel"/i);
    expect(html).toMatch(/autocomplete="url"/i);
  });

  it("omits autocomplete for generic text fields (a wrong hint is worse than none)", () => {
    const html = renderForm({
      additionalFields: [{ label: "Referral source", name: "REF", type: "text" }],
    });
    // The text field's input carries no autocomplete attribute.
    expect(html).toMatch(/<input[^>]+name="REF"[^>]*>/);
    const refInput = html.match(/<input[^>]+name="REF"[^>]*>/)?.[0] ?? "";
    expect(refInput).not.toMatch(/autocomplete=/i);
  });

  it("skips rows missing a label or a name (incomplete inspector rows)", () => {
    const html = renderForm({
      additionalFields: [
        { label: "", name: "ORPHAN_NAME", type: "text" },
        { label: "No name", name: "", type: "text" },
        { label: "  ", name: "  ", type: "text" },
        { label: "Valid", name: "VALID", type: "text" },
      ],
    });
    // Only the complete row renders.
    expect(html).toMatch(/name="VALID"/);
    expect(html).not.toMatch(/name="ORPHAN_NAME"/);
    expect(html).not.toContain("No name");
  });

  it("gives each additional field a unique id distinct from the email field", () => {
    const html = renderForm({
      additionalFields: [
        { label: "Phone", name: "PHONE", type: "tel" },
        { label: "Country", name: "COUNTRY", type: "text" },
      ],
    });
    // Each label's `for` points at a distinct id; collect them.
    const ids = [...html.matchAll(/<label[^>]+for="([^"]+)"/g)].map((m) => m[1]);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it("renders additional fields alongside the name field (both compose)", () => {
    const html = renderForm({
      service: "mailchimp",
      hasNameField: true,
      additionalFields: [{ label: "Phone", name: "PHONE", type: "tel" }],
    });
    expect(html).toMatch(/name="FNAME"/);
    expect(html).toMatch(/name="PHONE"/);
    // The required email input is still present.
    expect(html).toMatch(/name="EMAIL"/);
  });

  it("drops a field that collides with the service email field name", () => {
    // An artist who names an extra field "EMAIL" (the Mailchimp email
    // attribute) would otherwise emit TWO name="EMAIL" inputs — the
    // provider gets two values and the subscription silently breaks
    // behind the opaque no-cors success. Skip the colliding row so the
    // required email input is the only EMAIL field.
    const html = renderForm({
      service: "mailchimp",
      additionalFields: [{ label: "Your email again", name: "EMAIL", type: "email" }],
    });
    const emailMatches = html.match(/name="EMAIL"/g) ?? [];
    expect(emailMatches).toHaveLength(1);
    // The colliding row's label is gone too (whole row dropped).
    expect(html).not.toContain("Your email again");
  });

  it("drops a field named `_gotcha` (would shadow the honeypot)", () => {
    const html = renderForm({
      additionalFields: [{ label: "Comments", name: "_gotcha", type: "text" }],
    });
    // Only the hidden honeypot carries name="_gotcha"; the visible
    // field is dropped, so the label never appears.
    expect(html).not.toContain("Comments");
  });

  it("drops a field colliding with the name field name only when the name field is on", () => {
    // FNAME is reserved only when hasNameField renders the name input.
    const withName = renderForm({
      service: "mailchimp",
      hasNameField: true,
      additionalFields: [{ label: "Extra", name: "FNAME", type: "text" }],
    });
    // Just the curated name field — the colliding extra row is dropped.
    expect((withName.match(/name="FNAME"/g) ?? [])).toHaveLength(1);
    expect(withName).not.toContain("Extra");

    // With the name field off, FNAME isn't rendered by the form, so an
    // additional field may legitimately use it.
    const withoutName = renderForm({
      service: "mailchimp",
      hasNameField: false,
      additionalFields: [{ label: "Extra", name: "FNAME", type: "text" }],
    });
    expect(withoutName).toMatch(/name="FNAME"/);
    expect(withoutName).toContain("Extra");
  });

  it("drops a field colliding with the Mailchimp b_* honeypot", () => {
    const html = renderForm({
      service: "mailchimp",
      actionUrl: "https://x.us1.list-manage.com/subscribe/post?u=abc&id=xyz",
      additionalFields: [{ label: "Sneaky", name: "b_abc_xyz", type: "text" }],
    });
    // Only the hidden honeypot carries that name; the visible row drops.
    expect((html.match(/name="b_abc_xyz"/g) ?? [])).toHaveLength(1);
    expect(html).not.toContain("Sneaky");
  });

  it("coerces an out-of-union input type (hand-edited JSON) to text", () => {
    // On-disk data is untyped at runtime; a bad `type` shouldn't
    // render <input type="hidden"> (invisible but posting) or a
    // number field that rejects "+1 555…".
    const html = renderForm({
      additionalFields: [
        // @ts-expect-error — exercising the runtime coercion path
        { label: "Phone", name: "PHONE", type: "number" },
      ],
    });
    expect(html).toMatch(/<input[^>]+name="PHONE"[^>]*type="text"|<input[^>]+type="text"[^>]*name="PHONE"/);
    expect(html).not.toMatch(/name="PHONE"[^>]*type="number"/);
  });

  it("does not crash on rows with null/missing label or name (hand-edited JSON)", () => {
    const html = renderForm({
      additionalFields: [
        // @ts-expect-error — simulating malformed on-disk rows
        { label: null, name: "X", type: "text" },
        // @ts-expect-error — missing name key entirely
        { label: "Y", type: "text" },
        { label: "Good", name: "GOOD", type: "text" },
      ],
    });
    // Renders without throwing; only the well-formed row survives.
    expect(html).toMatch(/<form/);
    expect(html).toMatch(/name="GOOD"/);
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
