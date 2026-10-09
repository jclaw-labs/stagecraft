/**
 * Application-layer encryption for stored integration credentials
 * (`Account.access_token` / `refresh_token` / `id_token` and
 * `IntegrationAccount.accessToken` / `refreshToken`). See ADR-005.
 *
 * AES-256-GCM through WebCrypto (`globalThis.crypto.subtle`), which exists
 * both on Node 20+ (Netlify) and on Cloudflare Workers, so the same code
 * runs on either host.
 *
 * Stored format (all segments base64url, no padding):
 *
 *   enc:v1:<keyId>:<iv>:<tag>:<ciphertext>
 *
 * The key id travels with the value, so keys rotate without a flag day:
 * `STAGECRAFT_CREDENTIALS_KEY` is the current key (encrypts and decrypts),
 * `STAGECRAFT_CREDENTIALS_OLD_KEYS` holds retired keys that only decrypt.
 * Each key is written `<keyId>:<base64 of 32 random bytes>`; old keys are
 * comma-separated.
 *
 * Rollout rules:
 * - Values without the `enc:` prefix are legacy plaintext and are returned
 *   unchanged by `decryptCredential`, so reads keep working until the
 *   backfill script (`apps/web/scripts/encrypt-credentials.ts`) has run.
 * - With no current key set, `encryptCredential` returns the plaintext and
 *   logs one warning per process, so a deploy that lands before the secret
 *   doesn't break sign-in or the connect flows.
 * - A value that *is* encrypted but can't be decrypted (unknown key id,
 *   wrong key, tampered bytes) throws. Never hand ciphertext to a provider.
 */

export const CREDENTIALS_KEY_ENV = "STAGECRAFT_CREDENTIALS_KEY";
export const CREDENTIALS_OLD_KEYS_ENV = "STAGECRAFT_CREDENTIALS_OLD_KEYS";

const PREFIX = "enc:v1:";
const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

interface CredentialKey {
  id: string;
  key: CryptoKey;
}

interface Keyring {
  current: CredentialKey | null;
  byId: Map<string, CryptoKey>;
}

let warnedMissingKey = false;
let cachedKeyring: { source: string; keyring: Promise<Keyring> } | null = null;

function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(Buffer.from(value, "base64url"));
}

async function parseKey(spec: string, envName: string): Promise<CredentialKey> {
  const separator = spec.indexOf(":");
  const id = separator === -1 ? "" : spec.slice(0, separator).trim();
  const material = separator === -1 ? "" : spec.slice(separator + 1).trim();
  if (!KEY_ID_PATTERN.test(id)) {
    throw new Error(
      `${envName} must be "<keyId>:<base64 key>" with a keyId of letters, digits, "_" or "-"`,
    );
  }
  const raw = new Uint8Array(Buffer.from(material, "base64"));
  if (raw.length !== KEY_BYTES) {
    throw new Error(`${envName} key "${id}" must decode to ${KEY_BYTES} bytes, got ${raw.length}`);
  }
  const key = await crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
  return { id, key };
}

async function buildKeyring(currentSpec: string, oldSpecs: string): Promise<Keyring> {
  const byId = new Map<string, CryptoKey>();
  const current = currentSpec ? await parseKey(currentSpec, CREDENTIALS_KEY_ENV) : null;
  if (current) byId.set(current.id, current.key);
  for (const spec of oldSpecs.split(",").map((s) => s.trim()).filter(Boolean)) {
    const old = await parseKey(spec, CREDENTIALS_OLD_KEYS_ENV);
    if (byId.has(old.id)) {
      throw new Error(`Credential key id "${old.id}" is configured more than once`);
    }
    byId.set(old.id, old.key);
  }
  return { current, byId };
}

/** Read the keys from the environment, re-parsing only when it changes. */
function getKeyring(): Promise<Keyring> {
  const currentSpec = process.env[CREDENTIALS_KEY_ENV]?.trim() ?? "";
  const oldSpecs = process.env[CREDENTIALS_OLD_KEYS_ENV]?.trim() ?? "";
  const source = `${currentSpec}\n${oldSpecs}`;
  if (cachedKeyring?.source !== source) {
    const keyring = buildKeyring(currentSpec, oldSpecs);
    // Don't cache a failed parse: a later call should report it again.
    keyring.catch(() => {
      if (cachedKeyring?.keyring === keyring) cachedKeyring = null;
    });
    cachedKeyring = { source, keyring };
  }
  return cachedKeyring.keyring;
}

function additionalData(keyId: string): Uint8Array<ArrayBuffer> {
  // Binds the ciphertext to its version and key id, so neither can be
  // swapped without the tag check failing.
  return new TextEncoder().encode(`${PREFIX}${keyId}`);
}

/** True when `value` is in the encrypted storage format. */
export function isEncryptedCredential(value: string): boolean {
  return value.startsWith(PREFIX);
}

/**
 * Encrypt a credential for storage. Already-encrypted values are returned
 * unchanged. With no current key configured, returns the plaintext and
 * warns once (see the module comment).
 */
export async function encryptCredential(plaintext: string): Promise<string> {
  if (isEncryptedCredential(plaintext)) return plaintext;
  const { current } = await getKeyring();
  if (!current) {
    if (!warnedMissingKey) {
      warnedMissingKey = true;
      console.warn(
        `${CREDENTIALS_KEY_ENV} is not set; integration credentials are being stored unencrypted. ` +
          "Set the key and run apps/web/scripts/encrypt-credentials.ts (docs/runbook.md).",
      );
    }
    return plaintext;
  }
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: additionalData(current.id), tagLength: TAG_BYTES * 8 },
      current.key,
      new TextEncoder().encode(plaintext),
    ),
  );
  // WebCrypto appends the tag to the ciphertext; store it as its own segment.
  const ciphertext = sealed.subarray(0, sealed.length - TAG_BYTES);
  const tag = sealed.subarray(sealed.length - TAG_BYTES);
  return `${PREFIX}${current.id}:${toBase64Url(iv)}:${toBase64Url(tag)}:${toBase64Url(ciphertext)}`;
}

/**
 * Decrypt a stored credential. Legacy plaintext (no `enc:` prefix) is
 * returned unchanged. Throws when an encrypted value can't be decrypted.
 */
export async function decryptCredential(stored: string): Promise<string> {
  if (!isEncryptedCredential(stored)) return stored;
  const parts = stored.slice(PREFIX.length).split(":");
  if (parts.length !== 4) {
    throw new Error("Stored credential is malformed");
  }
  const [keyId, ivPart, tagPart, ciphertextPart] = parts;
  const { byId } = await getKeyring();
  const key = byId.get(keyId);
  if (!key) {
    throw new Error(
      `Stored credential was encrypted with key "${keyId}", which is not configured ` +
        `(${CREDENTIALS_KEY_ENV} / ${CREDENTIALS_OLD_KEYS_ENV})`,
    );
  }
  const iv = fromBase64Url(ivPart);
  const tag = fromBase64Url(tagPart);
  const ciphertext = fromBase64Url(ciphertextPart);
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new Error("Stored credential is malformed");
  }
  const sealed = new Uint8Array(ciphertext.length + TAG_BYTES);
  sealed.set(ciphertext);
  sealed.set(tag, ciphertext.length);
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: additionalData(keyId), tagLength: TAG_BYTES * 8 },
      key,
      sealed,
    );
  } catch {
    throw new Error(`Stored credential failed to decrypt with key "${keyId}"`);
  }
  return new TextDecoder().decode(plaintext);
}

/** Id of the key `encryptCredential` writes with, or null when none is set. */
export async function currentCredentialKeyId(): Promise<string | null> {
  return (await getKeyring()).current?.id ?? null;
}

/** Id of the key an encrypted value was written with; null for plaintext. */
export function credentialKeyId(stored: string): string | null {
  if (!isEncryptedCredential(stored)) return null;
  return stored.slice(PREFIX.length).split(":")[0] ?? null;
}

/** `encryptCredential` that passes `null` / `undefined` through. */
export async function encryptOptionalCredential<T extends string | null | undefined>(
  value: T,
): Promise<T> {
  if (value === null || value === undefined) return value;
  return (await encryptCredential(value)) as T;
}

/** `decryptCredential` that passes `null` / `undefined` through. */
export async function decryptOptionalCredential<T extends string | null | undefined>(
  value: T,
): Promise<T> {
  if (value === null || value === undefined) return value;
  return (await decryptCredential(value)) as T;
}

/** Test hook: forget the cached keys and the one-time warning. */
export function resetCredentialCryptoForTests(): void {
  cachedKeyring = null;
  warnedMissingKey = false;
}
