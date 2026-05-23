import { getSession } from "@/lib/auth";
import { getRequestReadStore } from "@/lib/collections";
import { readAppearance } from "@/lib/content";
import { getHasPendingSingletonChange } from "@/lib/draft-changes";

import { AdminShell } from "@/components/admin/AdminShell";

import { AppearanceForm } from "./AppearanceForm";

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
