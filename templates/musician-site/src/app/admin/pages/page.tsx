import { getSession } from "#lib/auth.js";
import { getRequestReadStore } from "#lib/collections/index.js";
import { listPageSummaries } from "#lib/content.js";

import { AdminPanel } from "#components/admin/AdminPanel.js";
import { AdminShell } from "#components/admin/AdminShell.js";

import { PagesPanel } from "./PagesPanel.js";

export default async function AdminPagesIndex() {
  const [session, pages] = await Promise.all([
    getSession(),
    getRequestReadStore().then((s) => listPageSummaries(s)),
  ]);
  return (
    <AdminShell activeSection="pages" email={session?.email ?? ""}>
      <AdminPanel
        title="Pages"
        description="Every URL on your site lives here. Drag to reorder; the order is also the order in the header nav. Use the eye icon to hide a page from the nav (it stays reachable by URL). Mark one as the splash to take over '/'."
      >
        <PagesPanel initialPages={pages} />
      </AdminPanel>
    </AdminShell>
  );
}
