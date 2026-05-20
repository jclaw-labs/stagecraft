"use client";

import { AdminPanel } from "@/components/admin/AdminShell";
import {
  CheckboxField,
  FieldGroup,
  TextField,
} from "@/components/admin/form";
import { SaveBar } from "@/components/admin/SaveBar";
import { useSettingsForm } from "@/components/admin/useSettingsForm";
import {
  SOCIAL_PLATFORMS,
  SOCIAL_PLATFORM_LABELS,
  type SiteConfig,
  type SocialPlatform,
} from "@/lib/site-config-types";

type Props = {
  initial: SiteConfig;
  /**
   * Currently-signed-in admin email. Used to surface a sandbox-mode
   * warning when the contact email diverges and Resend can only deliver
   * to the verified account address.
   */
  adminEmail: string;
  /**
   * True when outgoing mail still flows through Resend's shared sandbox
   * sender (no verified domain provisioned). In that mode Resend will
   * only deliver to addresses verified on the account, so contactEmail
   * has to match the admin sign-in email or messages won't arrive.
   */
  isResendSandbox: boolean;
};

/**
 * Form for `src/content/config/site.json`. Groups fields into Identity,
 * Social links, and Footer — same structure as the legacy template's
 * Keystatic schema, but with the conditional/discriminator wrappers removed.
 */
export function SiteSettingsForm({ initial, adminEmail, isResendSandbox }: Props) {
  const form = useSettingsForm<SiteConfig>({
    initial,
    endpoint: "/api/save-config",
    kind: "site-config",
  });

  function setField<K extends keyof SiteConfig>(key: K, val: SiteConfig[K]) {
    form.setValue((prev) => ({ ...prev, [key]: val }));
  }

  function setSocial(platform: SocialPlatform, val: string) {
    form.setValue((prev) => ({
      ...prev,
      socialLinks: { ...prev.socialLinks, [platform]: val },
    }));
  }

  return (
    <AdminPanel
      title="Site Settings"
      description="Identity (artist name, site title), social links shown in the footer, contact email used by forms, and the copyright line."
      saveBar={<SaveBar {...form.saveBarProps} />}
    >
      <FieldGroup
        title="Identity"
        description="How the site introduces itself in the browser tab, search results, and the footer."
      >
        <TextField
          id="artistName"
          label="Artist name"
          description="Used in the header (when no wordmark is set), the document title, and the default copyright line."
          value={form.value.artistName}
          onChange={(v) => setField("artistName", v)}
          isRequired
        />
        <TextField
          id="siteTitle"
          label="Site title"
          description="Full document title — appears in browser tabs and search results."
          value={form.value.siteTitle}
          onChange={(v) => setField("siteTitle", v)}
          isRequired
        />
        <TextField
          id="siteDescription"
          label="Site description"
          description="One- or two-sentence summary for search engines and social previews."
          value={form.value.siteDescription}
          onChange={(v) => setField("siteDescription", v)}
          isMultiline
          rows={2}
        />
        <TextField
          id="contactEmail"
          label="Contact email"
          description={
            <ContactEmailDescription
              adminEmail={adminEmail}
              isResendSandbox={isResendSandbox}
              currentValue={form.value.contactEmail}
            />
          }
          value={form.value.contactEmail}
          onChange={(v) => setField("contactEmail", v)}
          type="email"
          isRequired
        />
      </FieldGroup>

      <FieldGroup
        title="Social links"
        description="Each link surfaces as an icon in the site footer. Leave a field blank to hide that platform."
      >
        {SOCIAL_PLATFORMS.map((platform) => (
          <TextField
            key={platform}
            id={`social-${platform}`}
            label={SOCIAL_PLATFORM_LABELS[platform]}
            value={form.value.socialLinks[platform] ?? ""}
            onChange={(v) => setSocial(platform, v)}
            type="url"
            placeholder={`https://${platform === "appleMusic" ? "music.apple.com" : platform + ".com"}/...`}
          />
        ))}
      </FieldGroup>

      <FieldGroup
        title="Footer"
        description="Copyright line and a site-wide footer-hide toggle (per-page overrides also exist)."
      >
        <TextField
          id="copyrightName"
          label="Copyright holder (optional)"
          description="Defaults to your artist name. Set only when the copyright sits with a different entity (label, estate, civil name). The footer renders “© {year} {this}. All rights reserved.”"
          value={form.value.copyrightName}
          onChange={(v) => setField("copyrightName", v)}
        />
        <CheckboxField
          id="isFooterHidden"
          label="Hide footer site-wide"
          description="When enabled, the social-links + copyright footer is hidden on every page. Individual pages can override this via the page's own “Hide footer” toggle."
          value={form.value.isFooterHidden}
          onChange={(v) => setField("isFooterHidden", v)}
        />
      </FieldGroup>
    </AdminPanel>
  );
}

/**
 * Description renderer for the Contact email field. Always states that
 * the address is server-side only; conditionally adds a sandbox-mode
 * warning when the artist hasn't connected a custom domain and the
 * value diverges from their sign-in email — in that mode Resend only
 * delivers to addresses verified on the account.
 *
 * Exported for unit testing.
 */
export function ContactEmailDescription({
  adminEmail,
  isResendSandbox,
  currentValue,
}: {
  adminEmail: string;
  isResendSandbox: boolean;
  currentValue: string;
}) {
  const normalizedAdmin = adminEmail.trim().toLowerCase();
  const normalizedCurrent = currentValue.trim().toLowerCase();
  const isDiverged =
    isResendSandbox &&
    normalizedAdmin.length > 0 &&
    normalizedCurrent.length > 0 &&
    normalizedAdmin !== normalizedCurrent;

  return (
    <>
      Where contact-form submissions are delivered. Never appears on your public
      site — used only to forward messages to you.
      {isDiverged ? (
        <span
          role="status"
          style={{
            display: "block",
            marginTop: "var(--space-2)",
            color: "var(--color-text-error)",
          }}
        >
          Heads up: your site is still using the shared email sender, which only
          delivers to {normalizedAdmin}. Set the contact email to your sign-in
          address — or connect a custom email domain — to receive messages.
        </span>
      ) : null}
    </>
  );
}
