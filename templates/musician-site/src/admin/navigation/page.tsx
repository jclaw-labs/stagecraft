import { getSession } from "#lib/auth.js";
import { getRequestReadStore } from "#lib/collections/index.js";
import { readHeaderConfig } from "#lib/content.js";
import { getHasPendingSingletonChange } from "#lib/draft-changes.js";

import { AdminShell } from "#components/admin/AdminShell.js";

import { NavigationForm } from "./NavigationForm.js";

export default async function AdminNavigationPage() {
  const [session, config, hasPendingChanges] = await Promise.all([
    getSession(),
    getRequestReadStore().then((s) => readHeaderConfig(s)),
    getHasPendingSingletonChange("header"),
  ]);
  return (
    <AdminShell activeSection="navigation" email={session?.email ?? ""}>
      <NavigationForm initial={config} hasPendingChanges={hasPendingChanges} />
    </AdminShell>
  );
}
