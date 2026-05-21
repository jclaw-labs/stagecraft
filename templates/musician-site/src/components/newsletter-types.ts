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
