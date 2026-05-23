import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { validateVercelToken } from "@/lib/integrations/vercel";
import { prisma } from "@stagecraft/db";

/**
 * Connect a Vercel account via Personal Access Token.
 *
 * Vercel doesn't expose a simple "Sign in with Vercel" OAuth flow the way
 * GitHub does — their first-party model is the Integrations marketplace
 * (manual registration + callback). For now we accept a PAT pasted by the
 * artist from https://vercel.com/account/tokens. We validate the token by
 * calling /v2/user before storing it, so a typo doesn't get silently
 * persisted.
 */
const connectSchema = z.object({
  token: z.string().trim().min(1, "Token is required"),
  /** Optional: scope subsequent project creates to a specific Vercel team. */
  teamId: z.string().trim().min(1).optional(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const parsed = connectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    );
  }

  const { token, teamId } = parsed.data;

  let user: { userId: string; username: string };
  try {
    user = await validateVercelToken(token);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return NextResponse.json(
      { error: `Vercel rejected the token: ${message}` },
      { status: 400 },
    );
  }

  await prisma.integrationAccount.upsert({
    where: {
      userId_provider: { userId: session.user.id, provider: "vercel" },
    },
    update: {
      accessToken: token,
      providerAccountId: user.userId,
      metadata: { username: user.username, teamId: teamId ?? null },
      updatedAt: new Date(),
    },
    create: {
      userId: session.user.id,
      provider: "vercel",
      providerAccountId: user.userId,
      accessToken: token,
      metadata: { username: user.username, teamId: teamId ?? null },
    },
  });

  return NextResponse.json({
    ok: true,
    username: user.username,
  });
}

export async function DELETE() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Idempotent disconnect: removes the integration row if present.
  await prisma.integrationAccount.deleteMany({
    where: { userId: session.user.id, provider: "vercel" },
  });

  return NextResponse.json({ ok: true });
}
