import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import AppShell from "@/components/AppShell";

import SiteDetailClient from "./SiteDetailClient";

export default async function SiteDetailPage({
  params,
}: {
  params: Promise<{ siteId: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }
  const { siteId } = await params;

  return (
    <AppShell user={{ name: session.user.name, email: session.user.email }} current="sites">
      <SiteDetailClient siteId={siteId} />
    </AppShell>
  );
}
