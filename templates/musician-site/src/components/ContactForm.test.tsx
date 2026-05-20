import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { ContactForm } from "./ContactForm";

/**
 * Static markup checks only — the submit handler runs in the browser
 * and is exercised via integration tests of the underlying
 * /api/contact route. Here we just verify the SSR'd HTML has the
 * fields, the honeypot, and the required-flag wiring artists expect.
 */

describe("<ContactForm />", () => {
  const html = renderToStaticMarkup(<ContactForm />);

  it("renders name, email, subject, and message fields", () => {
    expect(html).toContain('name="name"');
    expect(html).toContain('name="email"');
    expect(html).toContain('name="subject"');
    expect(html).toContain('name="message"');
  });

  it("marks name, email, and message as required (subject is not)", () => {
    // The required attribute appears in the rendered output. Subject's
    // <input> sits between the email block and message block — easiest
    // assertion is the count plus a negative match on the subject input.
    const requiredMatches = html.match(/required/g) ?? [];
    expect(requiredMatches.length).toBeGreaterThanOrEqual(3);
    // Subject input has no `required` directly attached.
    expect(html).toMatch(/<input[^>]*id="cf-subject"[^>]*\/?>/);
    const subjectMatch = html.match(/<input[^>]*id="cf-subject"[^>]*\/?>/);
    expect(subjectMatch?.[0]).not.toContain("required");
  });

  it("includes the empty-input honeypot field hidden from accessibility tree", () => {
    expect(html).toContain('name="website"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain('aria-hidden');
  });

  it("only uses design tokens for colors (no raw hex in inline styles)", () => {
    // Spacing / sizing tokens are covered by the existing config tests
    // for the surrounding Puck blocks; ContactForm just needs to keep
    // colors token-only since the form is inlined onto every page.
    expect(html).not.toMatch(/style="[^"]*#[0-9a-fA-F]{3,6}/);
  });
});
