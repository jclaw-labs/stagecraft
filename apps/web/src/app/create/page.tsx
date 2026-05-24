import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import AppShell from "@/components/AppShell";

import CreateClient from "./CreateClient";

export default async function CreateSitePage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  return (
    <AppShell user={{ name: session.user.name, email: session.user.email }} current="sites">
      <CreateClient />
    </AppShell>
  );
}
