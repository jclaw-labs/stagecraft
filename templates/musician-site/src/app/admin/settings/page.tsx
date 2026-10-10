import { getSession } from "#lib/auth.js";
import { getRequestReadStore } from "#lib/collections/index.js";
import { readSiteConfig } from "#lib/content.js";
import { getHasPendingSingletonChange } from "#lib/draft-changes.js";
import { isResendSandboxSender } from "#lib/email.js";

import { AdminShell } from "#components/admin/AdminShell.js";

import { SiteSettingsForm } from "./SiteSettingsForm.js";

export default async function AdminSettingsPage() {
  const [session, config, hasPendingChanges] = await Promise.all([
    getSession(),
    getRequestReadStore().then((s) => readSiteConfig(s)),
    getHasPendingSingletonChange("site"),
  ]);
  return (
    <AdminShell activeSection="settings" email={session?.email ?? ""}>
      <SiteSettingsForm
        initial={config}
        adminEmail={session?.email ?? ""}
        isResendSandbox={isResendSandboxSender()}
        hasPendingChanges={hasPendingChanges}
      />
    </AdminShell>
  );
}
