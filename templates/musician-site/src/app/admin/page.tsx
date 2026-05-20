import { redirect } from "next/navigation";

import { checkIsFirstRun } from "@/lib/first-run";

/**
 * `/admin` is just the sidebar's "home" — for steady-state sites it
 * bounces straight into the Pages panel because that's where editing
 * picks up. For fresh artist sites (no completed first-run wizard) it
 * bounces into `/admin/welcome` instead, so the empty Pages list isn't
 * the first thing they see.
 */
export default async function AdminRoot() {
  if (await checkIsFirstRun()) redirect("/admin/welcome");
  redirect("/admin/pages");
}
