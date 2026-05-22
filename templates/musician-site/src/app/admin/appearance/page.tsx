import { getSession } from "@/lib/auth";
import { getRequestReadStore } from "@/lib/collections";
import { readAppearance } from "@/lib/content";

import { AdminShell } from "@/components/admin/AdminShell";

import { AppearanceForm } from "./AppearanceForm";

export default async function AdminAppearancePage() {
  const [session, config] = await Promise.all([
    getSession(),
    getRequestReadStore().then((s) => readAppearance(s)),
  ]);
  return (
    <AdminShell activeSection="appearance" email={session?.email ?? ""}>
      <AppearanceForm initial={config} />
    </AdminShell>
  );
}
