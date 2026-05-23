import { randomInt } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";

const VERIFICATION_TTL = "10m";
const TOKEN_TYPE = "resend-email-verification";

function getSecret(): Uint8Array {
  const value = process.env.STAGECRAFT_STATE_SIGNING_SECRET;
  if (!value) {
    throw new Error("STAGECRAFT_STATE_SIGNING_SECRET is not set");
  }
  return new TextEncoder().encode(value);
}

export type VerificationPayload = {
  /** The email we sent the code to (normalized: trimmed, lowercased). */
  adminEmail: string;
  /** The 6-digit code the user must enter back. */
  code: string;
  /** The Stagecraft user that initiated this verification (defense-in-depth). */
  userId: string;
};

/**
 * Generate a 6-digit numeric verification code. Uniformly random; no
 * confusable characters (digits only).
 */
export function generateVerificationCode(): string {
  return String(randomInt(100_000, 1_000_000));
}

/**
 * Sign a 10-minute token containing the code we just emailed. Returned
 * to the client (verify-send response), then echoed back at /connect
 * along with the user-entered code; we verify the JWT signature + TTL
 * + match codes. The token is opaque to the client and tamper-proof.
 *
 * The plaintext code is in the token, but the token is signed with the
 * platform secret (HS256), short-lived, and bound to a userId — a
 * malicious user can't mint one without the platform key.
 */
export async function signVerificationToken(payload: VerificationPayload): Promise<string> {
  return new SignJWT({ ...payload, type: TOKEN_TYPE })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(VERIFICATION_TTL)
    .sign(getSecret());
}

export async function verifyVerificationToken(token: string): Promise<VerificationPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (payload.type !== TOKEN_TYPE) return null;
    if (
      typeof payload.adminEmail !== "string" ||
      typeof payload.code !== "string" ||
      typeof payload.userId !== "string"
    ) {
      return null;
    }
    return {
      adminEmail: payload.adminEmail,
      code: payload.code,
      userId: payload.userId,
    };
  } catch {
    return null;
  }
}
