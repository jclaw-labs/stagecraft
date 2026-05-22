import { describe, expect, it } from "vitest";

import {
  EMAIL_FIELD_NAME,
  NAME_FIELD_NAME,
  NEWSLETTER_SERVICES,
  parseMailchimpAudienceHoneypotName,
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
