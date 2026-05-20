import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { ContactEmailDescription } from "./SiteSettingsForm";

function render(props: {
  adminEmail: string;
  isResendSandbox: boolean;
  currentValue: string;
}): string {
  return renderToStaticMarkup(<ContactEmailDescription {...props} />);
}

describe("<ContactEmailDescription />", () => {
  it("always states that the contact email is server-side only", () => {
    const html = render({
      adminEmail: "artist@example.com",
      isResendSandbox: false,
      currentValue: "contact@example.com",
    });
    expect(html).toMatch(/Never appears on your public site/);
  });

  it("does not show the sandbox warning once a custom email domain is in use", () => {
    const html = render({
      adminEmail: "artist@example.com",
      isResendSandbox: false,
      currentValue: "other@example.com",
    });
    expect(html).not.toMatch(/Heads up/);
  });

  it("warns when sandbox sender + contactEmail diverges from sign-in email", () => {
    const html = render({
      adminEmail: "artist@example.com",
      isResendSandbox: true,
      currentValue: "bookings@example.com",
    });
    expect(html).toMatch(/Heads up/);
    expect(html).toContain("artist@example.com");
  });

  it("treats divergence case-insensitively (no false positive on capitalisation)", () => {
    const html = render({
      adminEmail: "Artist@Example.com",
      isResendSandbox: true,
      currentValue: "ARTIST@example.com",
    });
    expect(html).not.toMatch(/Heads up/);
  });

  it("skips the warning when the admin email is unknown (dev mode without ADMIN_EMAIL)", () => {
    const html = render({
      adminEmail: "",
      isResendSandbox: true,
      currentValue: "anything@example.com",
    });
    expect(html).not.toMatch(/Heads up/);
  });

  it("skips the warning when the contact email field is blank", () => {
    const html = render({
      adminEmail: "artist@example.com",
      isResendSandbox: true,
      currentValue: "",
    });
    expect(html).not.toMatch(/Heads up/);
  });
});
