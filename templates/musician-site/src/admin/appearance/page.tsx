import { getSession } from "#lib/auth.js";
import { getRequestReadStore } from "#lib/collections/index.js";
import { readAppearance } from "#lib/content.js";
import { getHasPendingSingletonChange } from "#lib/draft-changes.js";

import { AdminShell } from "#components/admin/AdminShell.js";

import { AppearanceForm } from "./AppearanceForm.js";

export default async function AdminAppearancePage() {
  const [session, config, hasPendingChanges] = await Promise.all([
    getSession(),
    getRequestReadStore().then((s) => readAppearance(s)),
    getHasPendingSingletonChange("appearance"),
  ]);
  return (
    <AdminShell activeSection="appearance" email={session?.email ?? ""}>
      <AppearanceForm initial={config} hasPendingChanges={hasPendingChanges} />
    </AdminShell>
  );
}
