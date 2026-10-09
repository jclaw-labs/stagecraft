import { redirect } from "next/navigation";

import { checkIsFirstRun } from "@/lib/first-run";

/**
 * Decide the redirect per request. Left to Next, this page reads no
 * request data, so `next build` prerendered it and baked in whichever
 * redirect the build-time content gave.
 */
export const dynamic = "force-dynamic";

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
