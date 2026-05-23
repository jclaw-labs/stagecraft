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

/**
 * Author-time validation of the actionUrl for a given provider.
 * Surfaced in the Puck inspector as a hint beneath the URL input,
 * so the artist gets feedback the moment they paste an obviously-
 * wrong URL — rather than discovering it days later when no
 * subscribers land in their list.
 *
 * Each branch enforces the minimum the runtime relies on:
 *
 *   - `mailchimp`  — needs `?u=USER_ID&id=LIST_ID` query params so
 *     `parseMailchimpAudienceHoneypotName` can synthesise the real
 *     honeypot field name. Without them, the bot defense is silently
 *     bypassed (still works for legitimate submits, but accepts
 *     spam).
 *   - `convertkit` — embed-form action URL is hosted at
 *     `app.kit.com/forms/<id>/subscriptions` (or legacy
 *     `app.convertkit.com/...`). The `/forms/<id>/subscriptions`
 *     suffix is the canonical pattern; anything else likely won't
 *     accept the POST.
 *   - `buttondown` — embed-subscribe URL is hosted at
 *     `buttondown.com/api/emails/embed-subscribe/<username>` (or
 *     legacy `buttondown.email/...`).
 *   - `generic`    — only validates URL parseability; the artist
 *     supplies the field-name contract themselves.
 *
 * Empty `actionUrl` returns `{ ok: true }`: the hint shouldn't fire
 * on a brand-new block before the artist has typed anything. The
 * required-ness of the field is the artist's choice to make once
 * they publish.
 *
 * Pure / synchronous; safe to call during render.
 */
export type NewsletterActionUrlValidation =
  | { ok: true }
  | { ok: false; message: string };

export function validateNewsletterActionUrl(
  service: NewsletterService,
  actionUrl: string,
): NewsletterActionUrlValidation {
  if (!actionUrl.trim()) return { ok: true };
  let url: URL;
  try {
    url = new URL(actionUrl);
  } catch {
    return {
      ok: false,
      message:
        "This doesn't look like a URL — paste the form-submission " +
        "URL from your provider's embed snippet.",
    };
  }
  if (service === "mailchimp") {
    const u = url.searchParams.get("u");
    const id = url.searchParams.get("id");
    if (!u || !id) {
      return {
        ok: false,
        message:
          "This URL is missing Mailchimp's audience parameters — " +
          "expected `?u=USER_ID&id=LIST_ID`. Without them the form " +
          "still posts but the bot defense is bypassed.",
      };
    }
  } else if (service === "convertkit") {
    // Both the modern (`app.kit.com`) and legacy (`app.convertkit.com`)
    // hosts ship the same `/forms/<id>/subscriptions` path. Accept
    // either host; reject anything else with a hint pointing at the
    // canonical shape.
    const host = url.host.toLowerCase();
    const isHost = host === "app.kit.com" || host === "app.convertkit.com";
    const isPath = /^\/forms\/[^/]+\/subscriptions\/?$/.test(url.pathname);
    if (!isHost || !isPath) {
      return {
        ok: false,
        message:
          "This URL doesn't match the ConvertKit / Kit embed pattern — " +
          "expected `https://app.kit.com/forms/FORM_ID/subscriptions` " +
          "(or the legacy `app.convertkit.com` host).",
      };
    }
  } else if (service === "buttondown") {
    const host = url.host.toLowerCase();
    const isHost = host === "buttondown.com" || host === "buttondown.email";
    const isPath = /^\/api\/emails\/embed-subscribe\/[^/]+\/?$/.test(
      url.pathname,
    );
    if (!isHost || !isPath) {
      return {
        ok: false,
        message:
          "This URL doesn't match the Buttondown embed pattern — " +
          "expected `https://buttondown.com/api/emails/embed-subscribe/USERNAME`.",
      };
    }
  }
  // `generic` falls through — only URL parseability is checked above.
  return { ok: true };
}
