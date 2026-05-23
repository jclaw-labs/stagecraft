/**
 * Server-safe constants for the NewsletterSignup block. Split out of
 * `NewsletterSignup.tsx` (which has `"use client"`) so server-side
 * importers — chiefly `puck/config.tsx`, which iterates
 * `NEWSLETTER_SERVICES` to build the block's select-field options —
 * get the real values instead of Next's client-reference proxy.
 *
 * Next treats every export from a `"use client"` module as a client-
 * reference proxy. Constants come back as opaque proxy objects that
 * don't carry their original methods (`.map(...)` blows up at server-
 * render time). Splitting data-only exports into a non-`"use client"`
 * sibling keeps both server and client consumers happy.
 *
 * The matching pattern in this codebase: `field-classification.ts`,
 * `filter-schema.ts`, `puck-content-value.ts` — all isolate
 * data/types from the runtime that imports `node:crypto` or owns
 * `"use client"` boundaries.
 */

export const NEWSLETTER_SERVICES = [
  "mailchimp",
  "convertkit",
  "buttondown",
  "generic",
] as const;
export type NewsletterService = (typeof NEWSLETTER_SERVICES)[number];

export const NEWSLETTER_SERVICE_LABELS: Record<NewsletterService, string> = {
  mailchimp: "Mailchimp",
  convertkit: "ConvertKit / Kit",
  buttondown: "Buttondown",
  generic: "Generic (custom)",
};

/**
 * Per-service field name for the subscriber's email. Each provider's
 * form handler reads a specific field name — POSTing the wrong name
 * silently succeeds (no-cors response is opaque) but the subscriber
 * never lands in the list, which the artist won't notice until
 * checking their dashboard.
 *
 *   - Mailchimp:    `EMAIL`         (their merge-field convention)
 *   - ConvertKit:   `email_address` (form-embed convention)
 *   - Buttondown:   `email`         (embed + API)
 *   - Generic:      `email`         (most permissive default; the
 *                                   artist's "generic" provider chose
 *                                   their own field name and the
 *                                   actionUrl handler reads it)
 *
 * Adding a new service: extend `NEWSLETTER_SERVICES` + record the
 * field name here. The dispatch table is the single source of truth.
 */
export const EMAIL_FIELD_NAME: Record<NewsletterService, string> = {
  mailchimp: "EMAIL",
  convertkit: "email_address",
  buttondown: "email",
  generic: "email",
};

/**
 * Per-service field name for the subscriber's first name (when the
 * optional name field is enabled). Same field-name-matters reasoning
 * as `EMAIL_FIELD_NAME` — a wrong name posts silently and never
 * lands in the list.
 *
 *   - Mailchimp:    `FNAME`              (their first-name merge field)
 *   - ConvertKit:   `fields[first_name]` (form-embed nested-fields convention)
 *   - Buttondown:   `metadata[name]`     (their custom-metadata bucket)
 *   - Generic:      `name`               (most permissive default)
 */
export const NAME_FIELD_NAME: Record<NewsletterService, string> = {
  mailchimp: "FNAME",
  convertkit: "fields[first_name]",
  buttondown: "metadata[name]",
  generic: "name",
};

/**
 * Input types offered for a custom additional field. Maps directly to
 * the `<input type>` attribute. The set is deliberately small — the
 * common asks beyond first-name are phone (`tel`), country / custom
 * text (`text`), a secondary email (`email`), and a website (`url`).
 * Richer types (date, select) would need provider-specific encoding
 * we don't want to guess at; the artist drops to `text` for those.
 */
export const NEWSLETTER_FIELD_TYPES = ["text", "email", "tel", "url"] as const;
export type NewsletterFieldType = (typeof NEWSLETTER_FIELD_TYPES)[number];

export const NEWSLETTER_FIELD_TYPE_LABELS: Record<NewsletterFieldType, string> = {
  text: "Text",
  email: "Email",
  tel: "Phone",
  url: "Website / URL",
};

/**
 * One artist-defined extra field beyond the curated email + name.
 * Unlike the name field (which maps to a per-service attribute via
 * `NAME_FIELD_NAME`), the `name` here is the raw form-field attribute
 * the artist copies from their provider's embed code — we can't infer
 * it, so it's verbatim. `autoComplete` is derived from `type` at
 * render so browsers still offer sensible autofill.
 */
export type NewsletterAdditionalField = {
  /** Visible (screen-reader) label. */
  label: string;
  /** Raw form-field `name` attribute, provider-specific. */
  name: string;
  /** Maps to the `<input type>`. */
  type: NewsletterFieldType;
};

/**
 * Coerce a possibly-unknown additional-field `type` to a member of
 * the union, falling back to `text`. The TS type constrains the
 * inspector, but Puck JSON on disk is untyped at runtime — a
 * hand-edited file or a future enum change could carry
 * `type: "number"` / `"hidden"` / etc., which would render an
 * `<input>` of that type verbatim (a `hidden` field the artist
 * can't see, a `number` field that rejects "+1 555…"). Same trust-
 * boundary reasoning as `normaliseCardSize` in puck/config.tsx.
 */
export function normaliseNewsletterFieldType(
  type: NewsletterFieldType | undefined,
): NewsletterFieldType {
  return (NEWSLETTER_FIELD_TYPES as readonly string[]).includes(type as string)
    ? (type as NewsletterFieldType)
    : "text";
}

/**
 * Map an additional-field input type to a reasonable `autocomplete`
 * token so browsers offer autofill. `text` is intentionally
 * unmapped (returns undefined) — a generic text field could be
 * anything (country, company, referral), and a wrong autocomplete
 * hint is worse than none. Pure / synchronous.
 */
export function newsletterFieldAutoComplete(
  type: NewsletterFieldType,
): string | undefined {
  switch (type) {
    case "email":
      return "email";
    case "tel":
      return "tel";
    case "url":
      return "url";
    case "text":
      return undefined;
  }
}

/**
 * Parse Mailchimp's actionUrl to extract the audience IDs that
 * suffix the real honeypot field name `b_<u>_<id>`. Mailchimp's
 * default embed URL is
 * `https://example.us20.list-manage.com/subscribe/post?u=USER_ID&id=LIST_ID`;
 * we read `u` + `id` and synthesise the suffixed name.
 *
 * The honeypot is a hidden field with the suffixed name that real
 * users leave empty. Mailchimp's bot defense rejects a submission
 * with anything in it. Without the right suffix, the field's name
 * doesn't match Mailchimp's pattern and the bot defense is bypassed
 * — which is to say, the legacy template's "generic placeholder"
 * gave zero protection. This function fixes that.
 *
 * Returns null when the URL doesn't look like Mailchimp's pattern.
 * Caller falls back to the universal client-side `_gotcha` honeypot
 * checked before POSTing.
 *
 * Pure / synchronous; safe to call during render.
 */
export function parseMailchimpAudienceHoneypotName(
  actionUrl: string,
): string | null {
  try {
    const url = new URL(actionUrl);
    const u = url.searchParams.get("u");
    const id = url.searchParams.get("id");
    if (!u || !id) return null;
    // Mailchimp's u + id are hex strings; reject anything weird so
    // we don't inject odd characters into the name attribute.
    if (!/^[a-z0-9]+$/i.test(u) || !/^[a-z0-9]+$/i.test(id)) return null;
    return `b_${u}_${id}`;
  } catch {
    return null;
  }
}
