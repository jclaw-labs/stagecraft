import { createCipheriv, randomBytes } from "node:crypto";

/** A fresh `<keyId>:<base64 of 32 bytes>` key spec. */
export function newCredentialKey(id: string): string {
  return `${id}:${randomBytes(32).toString("base64")}`;
}

/**
 * Encrypt in the legacy `enc:v1:` format exactly as #366 wrote it (AAD
 * `enc:v1:<keyId>`, no row binding), independently of credential-crypto.ts,
 * which no longer writes v1. Stands in for values already in production.
 */
export function encryptV1ForTests(plaintext: string, keySpec: string): string {
  const separator = keySpec.indexOf(":");
  const keyId = keySpec.slice(0, separator);
  const key = Buffer.from(keySpec.slice(separator + 1), "base64");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(`enc:v1:${keyId}`));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${keyId}:${iv.toString("base64url")}:${tag.toString("base64url")}:${ciphertext.toString("base64url")}`;
}
