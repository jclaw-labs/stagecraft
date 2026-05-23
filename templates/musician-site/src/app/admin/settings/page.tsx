import { getSession } from "@/lib/auth";
import { getRequestReadStore } from "@/lib/collections";
import { readSiteConfig } from "@/lib/content";
import { getHasPendingSingletonChange } from "@/lib/draft-changes";
import { isResendSandboxSender } from "@/lib/email";

import { AdminShell } from "@/components/admin/AdminShell";

import { SiteSettingsForm } from "./SiteSettingsForm";

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
