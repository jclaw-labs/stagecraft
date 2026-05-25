/**
 * Create-a-collection route.
 *
 *   /admin/collections/new
 *
 * Server component: gates on the session (redirect to /admin/login when
 * absent — defense-in-depth alongside the middleware), then renders the
 * AdminShell chrome around the client `NewCollectionForm`. The form
 * POSTs to `/api/collections` and routes to the new collection on
 * success.
 */

import { redirect } from "next/navigation";

import { AdminShell } from "@/components/admin/AdminShell";
import { getSession } from "@/lib/auth";

import { NewCollectionForm } from "./NewCollectionForm";

export default async function NewCollectionPage() {
  const session = await getSession();
  if (!session) redirect("/admin/login");

  return (
    <AdminShell activeSection="collections" email={session.email}>
      <NewCollectionForm />
    </AdminShell>
  );
}
