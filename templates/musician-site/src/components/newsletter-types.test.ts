import { describe, expect, it } from "vitest";

import {
  collidingAdditionalFieldNames,
  EMAIL_FIELD_NAME,
  NAME_FIELD_NAME,
  NEWSLETTER_ADDITIONAL_FIELDS_LABEL,
  NEWSLETTER_FIELD_TYPES,
  NEWSLETTER_FIELD_TYPE_LABELS,
  NEWSLETTER_SERVICES,
  newsletterAdditionalFieldsLabel,
  newsletterFieldAutoComplete,
  newsletterReservedFieldNames,
  parseMailchimpAudienceHoneypotName,
  validateNewsletterActionUrl,
  type NewsletterAdditionalField,
} from "./newsletter-types";

function field(name: string): NewsletterAdditionalField {
  return { label: name, name, type: "text" };
}

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

describe("NEWSLETTER_FIELD_TYPES + labels", () => {
  it("has a human-readable label for every field type", () => {
    for (const type of NEWSLETTER_FIELD_TYPES) {
      expect(NEWSLETTER_FIELD_TYPE_LABELS[type]).toBeTruthy();
    }
  });

  it("offers the four common input types", () => {
    expect([...NEWSLETTER_FIELD_TYPES]).toEqual(["text", "email", "tel", "url"]);
  });
});

describe("newsletterFieldAutoComplete", () => {
  it("maps email / tel / url to their autocomplete tokens", () => {
    expect(newsletterFieldAutoComplete("email")).toBe("email");
    expect(newsletterFieldAutoComplete("tel")).toBe("tel");
    expect(newsletterFieldAutoComplete("url")).toBe("url");
  });

  it("returns undefined for generic text (a wrong hint is worse than none)", () => {
    // A text field could be country, company, referral — there's no
    // single correct autocomplete token, so emit none.
    expect(newsletterFieldAutoComplete("text")).toBeUndefined();
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

describe("newsletterReservedFieldNames", () => {
  it("always reserves the universal honeypot + the service email field", () => {
    const reserved = newsletterReservedFieldNames("mailchimp", false, "");
    expect(reserved.has("_gotcha")).toBe(true);
    expect(reserved.has(EMAIL_FIELD_NAME.mailchimp)).toBe(true); // "EMAIL"
  });

  it("reserves the name field only when the name field is enabled", () => {
    expect(newsletterReservedFieldNames("mailchimp", false, "").has(NAME_FIELD_NAME.mailchimp)).toBe(
      false,
    );
    expect(newsletterReservedFieldNames("mailchimp", true, "").has(NAME_FIELD_NAME.mailchimp)).toBe(
      true,
    ); // "FNAME"
  });

  it("reserves the Mailchimp b_* honeypot only when the actionUrl parses", () => {
    const withHoneypot = newsletterReservedFieldNames(
      "mailchimp",
      false,
      "https://x.us1.list-manage.com/subscribe/post?u=abc&id=xyz",
    );
    expect(withHoneypot.has("b_abc_xyz")).toBe(true);

    // Unparseable URL → no honeypot reserved.
    const noHoneypot = newsletterReservedFieldNames("mailchimp", false, "https://artist.example/x");
    expect([...noHoneypot].some((n) => n.startsWith("b_"))).toBe(false);
  });

  it("doesn't reserve a b_* honeypot for non-Mailchimp services", () => {
    const reserved = newsletterReservedFieldNames(
      "buttondown",
      false,
      "https://x.us1.list-manage.com/subscribe/post?u=abc&id=xyz",
    );
    expect([...reserved].some((n) => n.startsWith("b_"))).toBe(false);
  });
});

describe("collidingAdditionalFieldNames", () => {
  it("finds a field colliding with the service email name", () => {
    // Mailchimp email field is "EMAIL".
    const colliding = collidingAdditionalFieldNames(
      [field("EMAIL"), field("PHONE")],
      "mailchimp",
      false,
      "",
    );
    expect(colliding).toEqual(["EMAIL"]);
  });

  it("finds a name-field collision only when the name field is on", () => {
    const off = collidingAdditionalFieldNames([field("FNAME")], "mailchimp", false, "");
    expect(off).toEqual([]);
    const on = collidingAdditionalFieldNames([field("FNAME")], "mailchimp", true, "");
    expect(on).toEqual(["FNAME"]);
  });

  it("ignores blank names and de-duplicates", () => {
    const colliding = collidingAdditionalFieldNames(
      [field("_gotcha"), field("_gotcha"), { label: "x", name: "  ", type: "text" }],
      "mailchimp",
      false,
      "",
    );
    expect(colliding).toEqual(["_gotcha"]);
  });

  it("returns empty when nothing collides", () => {
    expect(
      collidingAdditionalFieldNames([field("PHONE"), field("COUNTRY")], "mailchimp", false, ""),
    ).toEqual([]);
  });

  it("tolerates undefined / null-ish rows (hand-edited JSON)", () => {
    expect(collidingAdditionalFieldNames(undefined, "mailchimp", false, "")).toEqual([]);
  });
});

describe("newsletterAdditionalFieldsLabel", () => {
  it("returns the bare base label when nothing collides", () => {
    expect(newsletterAdditionalFieldsLabel([])).toBe(NEWSLETTER_ADDITIONAL_FIELDS_LABEL);
  });

  it("appends a singular warning naming the reserved field", () => {
    const label = newsletterAdditionalFieldsLabel(["EMAIL"]);
    expect(label.startsWith(NEWSLETTER_ADDITIONAL_FIELDS_LABEL)).toBe(true);
    expect(label).toContain("EMAIL");
    expect(label).toMatch(/name is reserved/);
    expect(label).toMatch(/won't be added/);
  });

  it("appends a plural warning listing all reserved names", () => {
    const label = newsletterAdditionalFieldsLabel(["EMAIL", "_gotcha"]);
    expect(label).toContain("EMAIL, _gotcha");
    expect(label).toMatch(/names are reserved/);
  });
});
