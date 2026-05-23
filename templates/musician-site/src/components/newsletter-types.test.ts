import { describe, expect, it } from "vitest";

import {
  EMAIL_FIELD_NAME,
  NAME_FIELD_NAME,
  NEWSLETTER_SERVICES,
  parseMailchimpAudienceHoneypotName,
  validateNewsletterActionUrl,
} from "./newsletter-types";

describe("EMAIL_FIELD_NAME + NAME_FIELD_NAME", () => {
  it("declares an entry for every service", () => {
    // Adding a service to NEWSLETTER_SERVICES without extending the
    // field-name dispatch tables is a runtime gotcha (TS catches
    // missing keys via `Record<NewsletterService, ...>` but not
    // accidental mistypes); the test pins the registry against the
    // enum.
    for (const service of NEWSLETTER_SERVICES) {
      expect(EMAIL_FIELD_NAME[service]).toBeTruthy();
      expect(NAME_FIELD_NAME[service]).toBeTruthy();
    }
  });
});

describe("parseMailchimpAudienceHoneypotName", () => {
  it("extracts `b_<u>_<id>` from a standard Mailchimp embed URL", () => {
    // Mailchimp's `?u=USER_ID&id=LIST_ID` query params synthesise
    // the honeypot field name `b_<u>_<id>`. Real users leave it
    // empty; bots that auto-fill every input trip Mailchimp's bot
    // defense at the provider end.
    expect(
      parseMailchimpAudienceHoneypotName(
        "https://example.us20.list-manage.com/subscribe/post?u=abc123&id=xyz789",
      ),
    ).toBe("b_abc123_xyz789");
  });

  it("returns null when the URL has no u / id params", () => {
    // Custom domain or partial URL: the caller falls back to the
    // client-side `_gotcha` honeypot instead of emitting a wrong
    // field name.
    expect(
      parseMailchimpAudienceHoneypotName("https://artist.example/subscribe"),
    ).toBeNull();
  });

  it("returns null when only one of u / id is present", () => {
    // Partial query string — defensive against truncated paste.
    expect(
      parseMailchimpAudienceHoneypotName(
        "https://example.us1.list-manage.com/subscribe/post?u=abc123",
      ),
    ).toBeNull();
  });

  it("returns null when u / id contain non-alphanumeric chars", () => {
    // Defensive against URL-encoded or otherwise weird inputs.
    // Mailchimp's IDs are hex; anything else would inject odd
    // characters into the rendered name attribute.
    expect(
      parseMailchimpAudienceHoneypotName(
        "https://x.us1.list-manage.com/subscribe/post?u=a-bc&id=xy",
      ),
    ).toBeNull();
    expect(
      parseMailchimpAudienceHoneypotName(
        "https://x.us1.list-manage.com/subscribe/post?u=abc&id=x%20y",
      ),
    ).toBeNull();
  });

  it("returns null for malformed URLs", () => {
    // The `new URL(...)` constructor throws on invalid input; the
    // helper catches and returns null rather than bubbling.
    expect(parseMailchimpAudienceHoneypotName("not a url")).toBeNull();
    expect(parseMailchimpAudienceHoneypotName("")).toBeNull();
  });

  it("accepts URLs from arbitrary Mailchimp pod hostnames", () => {
    // Mailchimp's pods include `.us1.`, `.us20.`, `.eu1.` etc.; the
    // helper doesn't care about hostname, only query params.
    expect(
      parseMailchimpAudienceHoneypotName(
        "https://x.eu1.list-manage.com/subscribe/post?u=def456&id=ghi012",
      ),
    ).toBe("b_def456_ghi012");
  });
});

describe("validateNewsletterActionUrl", () => {
  it("treats an empty URL as ok (no hint on a brand-new block)", () => {
    // The artist hasn't typed anything yet; popping a "required" hint
    // before they've engaged with the field is hostile UX. The
    // required-ness is enforced at publish time when (if) we add a
    // form-level guard — not during inspector authoring.
    for (const service of NEWSLETTER_SERVICES) {
      expect(validateNewsletterActionUrl(service, "")).toEqual({ ok: true });
      expect(validateNewsletterActionUrl(service, "   ")).toEqual({ ok: true });
    }
  });

  it("rejects unparseable URLs across every service with a parse-hint message", () => {
    for (const service of NEWSLETTER_SERVICES) {
      const result = validateNewsletterActionUrl(service, "not-a-url");
      expect(result.ok).toBe(false);
      // Same hint for every service — the URL isn't even parseable, so
      // a provider-specific message would be premature.
      if (!result.ok) expect(result.message).toMatch(/doesn't look like a URL/i);
    }
  });

  it("mailchimp: accepts URLs carrying ?u=...&id=...", () => {
    expect(
      validateNewsletterActionUrl(
        "mailchimp",
        "https://x.us20.list-manage.com/subscribe/post?u=abc&id=def",
      ),
    ).toEqual({ ok: true });
  });

  it("mailchimp: rejects URLs missing u or id", () => {
    // Missing both
    const a = validateNewsletterActionUrl(
      "mailchimp",
      "https://x.us20.list-manage.com/subscribe/post",
    );
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.message).toMatch(/u=USER_ID&id=LIST_ID/);
    // Missing one
    const b = validateNewsletterActionUrl(
      "mailchimp",
      "https://x.us20.list-manage.com/subscribe/post?u=abc",
    );
    expect(b.ok).toBe(false);
  });

  it("convertkit: accepts /forms/<id>/subscriptions on app.kit.com or app.convertkit.com", () => {
    expect(
      validateNewsletterActionUrl(
        "convertkit",
        "https://app.kit.com/forms/12345/subscriptions",
      ),
    ).toEqual({ ok: true });
    expect(
      validateNewsletterActionUrl(
        "convertkit",
        "https://app.convertkit.com/forms/12345/subscriptions",
      ),
    ).toEqual({ ok: true });
  });

  it("convertkit: rejects other hosts / paths", () => {
    const wrongHost = validateNewsletterActionUrl(
      "convertkit",
      "https://example.com/forms/12345/subscriptions",
    );
    expect(wrongHost.ok).toBe(false);
    const wrongPath = validateNewsletterActionUrl(
      "convertkit",
      "https://app.kit.com/something-else",
    );
    expect(wrongPath.ok).toBe(false);
  });

  it("buttondown: accepts /api/emails/embed-subscribe/<user> on buttondown.com or .email", () => {
    expect(
      validateNewsletterActionUrl(
        "buttondown",
        "https://buttondown.com/api/emails/embed-subscribe/alice",
      ),
    ).toEqual({ ok: true });
    expect(
      validateNewsletterActionUrl(
        "buttondown",
        "https://buttondown.email/api/emails/embed-subscribe/alice",
      ),
    ).toEqual({ ok: true });
  });

  it("buttondown: rejects other hosts / paths", () => {
    const wrongHost = validateNewsletterActionUrl(
      "buttondown",
      "https://example.com/api/emails/embed-subscribe/alice",
    );
    expect(wrongHost.ok).toBe(false);
    const wrongPath = validateNewsletterActionUrl(
      "buttondown",
      "https://buttondown.com/something/else",
    );
    expect(wrongPath.ok).toBe(false);
  });

  it("generic: only validates URL parseability", () => {
    // No host / path / query restrictions — the artist supplies the
    // field-name contract themselves, so any reachable URL is in scope.
    expect(
      validateNewsletterActionUrl("generic", "https://example.com/anywhere"),
    ).toEqual({ ok: true });
    expect(
      validateNewsletterActionUrl(
        "generic",
        "https://app.kit.com/different-path",
      ),
    ).toEqual({ ok: true });
  });
});
