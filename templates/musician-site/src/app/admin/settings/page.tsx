import { getSession } from "@/lib/auth";
import { readSiteConfig } from "@/lib/content";
import { isResendSandboxSender } from "@/lib/email";

import { AdminShell } from "@/components/admin/AdminShell";

import { SiteSettingsForm } from "./SiteSettingsForm";

export default async function AdminSettingsPage() {
  const [session, config] = await Promise.all([getSession(), readSiteConfig()]);
  return (
    <AdminShell activeSection="settings" email={session?.email ?? ""}>
      <SiteSettingsForm
        initial={config}
        adminEmail={session?.email ?? ""}
        isResendSandbox={isResendSandboxSender()}
      />
    </AdminShell>
  );
}
