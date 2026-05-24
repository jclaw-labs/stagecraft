import { auth, signIn } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function LoginPage() {
  const session = await auth();
  if (session?.user) {
    redirect("/dashboard");
  }

  return (
    <main style={{ maxWidth: 480, margin: "80px auto", fontFamily: "system-ui" }}>
      <h1>Sign in to Stagecraft</h1>
      <form
        action={async () => {
          "use server";
          await signIn("github", { redirectTo: "/dashboard" });
        }}
      >
        <button type="submit">Sign in with GitHub</button>
      </form>
    </main>
  );
}
