import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { encryptCredential, integrationCredentialField } from "@/lib/credential-crypto";
import { exchangeNetlifyCode } from "@/lib/integrations/oauth";
import { prisma } from "@stagecraft/db";
import { cookies } from "next/headers";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const cookieStore = await cookies();
  const storedState = cookieStore.get("netlify_oauth_state")?.value;

  if (!code || !state || state !== storedState) {
    return NextResponse.redirect(
      new URL("/settings?error=netlify_invalid_state", req.url)
    );
  }

  cookieStore.delete("netlify_oauth_state");

  try {
    const accessToken = await exchangeNetlifyCode(code);

    // Fetch Netlify user info
    const netlifyUser = await fetch("https://api.netlify.com/api/v1/user", {
      headers: { Authorization: `Bearer ${accessToken}` },
    }).then((r) => r.json() as Promise<{ id: string; email: string; full_name: string }>);

    const storedToken = await encryptCredential(
      accessToken,
      integrationCredentialField(session.user.id, "netlify", "accessToken"),
    );
    await prisma.integrationAccount.upsert({
      where: {
        userId_provider: {
          userId: session.user.id,
          provider: "netlify",
        },
      },
      update: {
        accessToken: storedToken,
        providerAccountId: netlifyUser.id,
        metadata: { email: netlifyUser.email, name: netlifyUser.full_name },
        updatedAt: new Date(),
      },
      create: {
        userId: session.user.id,
        provider: "netlify",
        providerAccountId: netlifyUser.id,
        accessToken: storedToken,
        metadata: { email: netlifyUser.email, name: netlifyUser.full_name },
      },
    });

    return NextResponse.redirect(
      new URL("/settings?success=netlify_connected", req.url)
    );
  } catch (error) {
    console.error("Netlify OAuth error:", error);
    return NextResponse.redirect(
      new URL("/settings?error=netlify_failed", req.url)
    );
  }
}
