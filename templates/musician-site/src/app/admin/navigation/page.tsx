import { getSession } from "@/lib/auth";
import { getRequestReadStore } from "@/lib/collections";
import { readHeaderConfig } from "@/lib/content";

import { AdminShell } from "@/components/admin/AdminShell";

import { NavigationForm } from "./NavigationForm";

export default async function AdminNavigationPage() {
  const [session, config] = await Promise.all([
    getSession(),
    getRequestReadStore().then((s) => readHeaderConfig(s)),
  ]);
  return (
    <AdminShell activeSection="navigation" email={session?.email ?? ""}>
      <NavigationForm initial={config} />
    </AdminShell>
  );
}
