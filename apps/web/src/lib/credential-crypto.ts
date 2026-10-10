/**
 * Application-layer encryption for stored integration credentials
 * (`Account.access_token` / `refresh_token` / `id_token` and
 * `IntegrationAccount.accessToken` / `refreshToken`). See ADR-005.
 *
 * AES-256-GCM through WebCrypto (`globalThis.crypto.subtle`), which exists
 * both on Node 20+ (Netlify) and on Cloudflare Workers, so the same code
 * runs on either host.
 *
 * Stored formats (all segments after the key id base64url, no padding):
 *
 *   enc:v2:<keyId>:<iv>:<tag>:<ciphertext>   written today
 *   enc:v1:<keyId>:<iv>:<tag>:<ciphertext>   legacy, read only
 *
 * Both bind the version and key id into the GCM additional data (AAD). v2
 * also binds the row and column the value belongs to (`CredentialField`),
 * so a ciphertext copied into another user's row, another provider's row
 * or another column fails the tag check instead of decrypting. v1 values
 * (written before #370) carry no row binding: while they are accepted they
 * decrypt in any row, exactly as before. The backfill script, run with
 * `--upgrade-v1`, upgrades them to v2, after which
 * `STAGECRAFT_CREDENTIALS_ACCEPT_V1=false` refuses v1 on
 * read, so an old v1 ciphertext (from a dump, or the database's history)
 * pasted into a row no longer decrypts. Until then the row binding covers
 * only values written as v2.
 *
 * The key id travels with the value, so keys rotate without a flag day:
 * `STAGECRAFT_CREDENTIALS_KEY` is the current key (encrypts and decrypts),
 * `STAGECRAFT_CREDENTIALS_OLD_KEYS` holds retired keys that only decrypt.
 * Each key is written `<keyId>:<base64 of 32 random bytes>` (standard
 * base64, 44 characters ending in `=`); old keys are comma-separated.
 *
 * Rollout rules:
 * - Values without the `enc:` prefix are legacy plaintext and are returned
 *   unchanged by `decryptCredential`, so reads keep working until the
 *   backfill script (`apps/web/scripts/encrypt-credentials.ts`) has run.
 * - With no current key set, `encryptCredential` refuses to write when
 *   credentials are required (`STAGECRAFT_CREDENTIALS_REQUIRED`, on by
 *   default when NODE_ENV is "production"), or when old keys are set
 *   without a current one (a half-done rotation). Otherwise (development,
 *   tests, or an explicit `STAGECRAFT_CREDENTIALS_REQUIRED=false`) it
 *   returns the plaintext and logs one warning per process.
 * - A value that *is* encrypted but can't be decrypted (unknown key id,
 *   wrong key, tampered bytes, wrong row) throws. Never hand ciphertext to
 *   a provider.
 */
import type { IntegrationProvider } from "@stagecraft/shared";

export const CREDENTIALS_KEY_ENV = "STAGECRAFT_CREDENTIALS_KEY";
export const CREDENTIALS_OLD_KEYS_ENV = "STAGECRAFT_CREDENTIALS_OLD_KEYS";
export const CREDENTIALS_REQUIRED_ENV = "STAGECRAFT_CREDENTIALS_REQUIRED";
export const CREDENTIALS_ACCEPT_V1_ENV = "STAGECRAFT_CREDENTIALS_ACCEPT_V1";

/** The token columns of NextAuth's `Account` that hold credentials. */
export const ACCOUNT_TOKEN_COLUMNS = ["access_token", "refresh_token", "id_token"] as const;
export type AccountTokenColumn = (typeof ACCOUNT_TOKEN_COLUMNS)[number];

/** The token columns of `IntegrationAccount` that hold credentials. */
export const INTEGRATION_TOKEN_COLUMNS = ["accessToken", "refreshToken"] as const;
export type IntegrationTokenColumn = (typeof INTEGRATION_TOKEN_COLUMNS)[number];

/**
 * One credential column of one `Account` row, named by the row's unique key
 * (`provider`, `providerAccountId`), which NextAuth knows before the row
 * exists. `provider` is NextAuth's provider id as it stores it; the app
 * doesn't own that set, so it stays a string.
 */
export interface AccountCredentialField {
  table: "Account";
  provider: string;
  providerAccountId: string;
  column: AccountTokenColumn;
}

/**
 * One credential column of one `IntegrationAccount` row, named by the row's
 * unique key (`userId`, `provider`).
 */
export interface IntegrationCredentialField {
  table: "IntegrationAccount";
  userId: string;
  provider: IntegrationProvider;
  column: IntegrationTokenColumn;
}

/** Where a stored credential lives; v2 ciphertexts are bound to it. */
export type CredentialField = AccountCredentialField | IntegrationCredentialField;

/** The storage format of a credential column's value. */
export type CredentialFormat = "plaintext" | "v1" | "v2";

/** The formats that carry an `enc:` prefix. */
export type EncryptedCredentialFormat = Exclude<CredentialFormat, "plaintext">;

const ENCRYPTED_PREFIX = "enc:";
const V1_PREFIX = "enc:v1:";
const V2_PREFIX = "enc:v2:";

/**
 * The prefix each encrypted format starts with: `credentialFormat` detects
 * a format by it, and a value is parsed by slicing off its own format's
 * prefix, so formats needn't share a prefix length.
 */
export const CREDENTIAL_FORMAT_PREFIXES: Readonly<Record<EncryptedCredentialFormat, string>> = {
  v1: V1_PREFIX,
  v2: V2_PREFIX,
};
const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
/** Standard base64 of exactly 32 bytes: 43 characters and one `=` of padding. */
const KEY_MATERIAL_PATTERN = /^[A-Za-z0-9+/]{43}=$/;
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

/**
 * Parse `<keyId>:<base64 key>`. The key material must be canonical standard
 * base64 of exactly 32 bytes; Buffer's own decoder would silently skip stray
 * characters, so a mangled secret could otherwise decode to a different key.
 * Errors name the env var and key id, never the material.
 */
async function parseKey(spec: string, envName: string): Promise<CredentialKey> {
  const separator = spec.indexOf(":");
  const id = separator === -1 ? "" : spec.slice(0, separator).trim();
  const material = separator === -1 ? "" : spec.slice(separator + 1).trim();
  if (!KEY_ID_PATTERN.test(id)) {
    throw new Error(
      `${envName} must be "<keyId>:<base64 key>" with a keyId of letters, digits, "_" or "-"`,
    );
  }
  if (!KEY_MATERIAL_PATTERN.test(material)) {
    throw new Error(
      `${envName} key "${id}" must be the standard base64 of ${KEY_BYTES} bytes ` +
        `(44 characters of A-Z, a-z, 0-9, "+" or "/", ending in "=")`,
    );
  }
  const raw = new Uint8Array(Buffer.from(material, "base64"));
  if (raw.length !== KEY_BYTES || Buffer.from(raw).toString("base64") !== material) {
    throw new Error(`${envName} key "${id}" is not canonical base64 of ${KEY_BYTES} bytes`);
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

/**
 * A "true" / "false" flag (any case, trimmed); `defaultValue` when unset or
 * empty. Any other value throws, so a typo can't flip a safety switch.
 */
function booleanFlag(envName: string, defaultValue: () => boolean): boolean {
  const raw = process.env[envName]?.trim().toLowerCase() ?? "";
  if (raw === "") return defaultValue();
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`${envName} must be "true" or "false"`);
}

/**
 * Whether a missing `STAGECRAFT_CREDENTIALS_KEY` makes writes fail instead
 * of storing plaintext. `STAGECRAFT_CREDENTIALS_REQUIRED` set to "true" or
 * "false" decides; unset (or empty), it is on exactly when NODE_ENV is
 * "production". Any other value throws, so a typo can't turn it off.
 */
export function credentialsRequired(): boolean {
  return booleanFlag(CREDENTIALS_REQUIRED_ENV, () => process.env.NODE_ENV === "production");
}

/**
 * Whether legacy, row-unbound `enc:v1:` values still decrypt.
 * `STAGECRAFT_CREDENTIALS_ACCEPT_V1` set to "true" or "false" decides;
 * unset (or empty), they do, so a deploy doesn't break before the backfill
 * has upgraded them. Set it to "false" once no v1 values are left (runbook
 * §9): only then is every stored credential bound to its row. Any other
 * value throws, which refuses v1 reads rather than accepting them.
 */
export function credentialsAcceptV1(): boolean {
  return booleanFlag(CREDENTIALS_ACCEPT_V1_ENV, () => true);
}

/**
 * The row binding v2 puts in the AAD: the table, the row's unique key and
 * the column, JSON-encoded so no id can be crafted to collide with another.
 */
export function credentialBinding(field: CredentialField): string {
  switch (field.table) {
    case "Account":
      return JSON.stringify(["Account", field.provider, field.providerAccountId, field.column]);
    case "IntegrationAccount":
      return JSON.stringify(["IntegrationAccount", field.userId, field.provider, field.column]);
  }
}

/**
 * The GCM additional data for a value in `format` under `keyId`, starting
 * with that format's own prefix. Exhaustive over the encrypted formats, so
 * adding one to `CredentialFormat` fails the type check here until its AAD
 * is defined. The bytes for v1 and v2 must never change: every stored value
 * would stop decrypting.
 */
export function credentialAdditionalData(
  format: EncryptedCredentialFormat,
  keyId: string,
  field: CredentialField,
): Uint8Array<ArrayBuffer> {
  const prefix = CREDENTIAL_FORMAT_PREFIXES[format];
  let aad: string;
  switch (format) {
    case "v1":
      // Unchanged since #366: only the version and key id.
      aad = `${prefix}${keyId}`;
      break;
    case "v2":
      // Adds the row binding, so a value moved to another row or column fails.
      aad = `${prefix}${keyId}:${credentialBinding(field)}`;
      break;
    default: {
      const unhandled: never = format;
      throw new Error(`No additional data defined for credential format "${String(unhandled)}"`);
    }
  }
  return new TextEncoder().encode(aad);
}

/** The `IntegrationAccount` field for `userId`'s `provider` row. */
export function integrationCredentialField(
  userId: string,
  provider: IntegrationProvider,
  column: IntegrationTokenColumn = "accessToken",
): IntegrationCredentialField {
  return { table: "IntegrationAccount", userId, provider, column };
}

/** True when `value` is encrypted (any `enc:` version, known or not). */
export function isEncryptedCredential(value: string): boolean {
  return value.startsWith(ENCRYPTED_PREFIX);
}

/**
 * The storage format of a stored value. Throws on an `enc:` value of a
 * version this code doesn't know, rather than calling it plaintext.
 */
export function credentialFormat(stored: string): CredentialFormat {
  if (!isEncryptedCredential(stored)) return "plaintext";
  // Detection and parsing (`encryptedSegments`) share the one prefix map.
  for (const [format, prefix] of Object.entries(CREDENTIAL_FORMAT_PREFIXES) as [
    EncryptedCredentialFormat,
    string,
  ][]) {
    if (stored.startsWith(prefix)) return format;
  }
  throw new Error("Stored credential has an unsupported format version");
}

/**
 * The `:`-separated segments after an encrypted value's own format prefix:
 * `[keyId, iv, tag, ciphertext]` when well formed.
 */
function encryptedSegments(stored: string, format: EncryptedCredentialFormat): string[] {
  return stored.slice(CREDENTIAL_FORMAT_PREFIXES[format].length).split(":");
}

/**
 * Encrypt a credential for storage in `field`, in the v2 format. With no
 * current key configured, throws or returns the plaintext with a one-time
 * warning (see the module comment). Throws on a value that already looks
 * encrypted: that is never a real credential, and storing it verbatim would
 * let a copied (unbound v1) ciphertext in through a connect form.
 */
export async function encryptCredential(plaintext: string, field: CredentialField): Promise<string> {
  if (isEncryptedCredential(plaintext)) {
    throw new Error("Refusing to encrypt a value that is already in the encrypted format");
  }
  const { current, byId } = await getKeyring();
  if (!current) {
    if (byId.size > 0) {
      throw new Error(
        `${CREDENTIALS_OLD_KEYS_ENV} is set but ${CREDENTIALS_KEY_ENV} is not; refusing to store ` +
          `a credential in plaintext. Set ${CREDENTIALS_KEY_ENV} (docs/runbook.md §9).`,
      );
    }
    if (credentialsRequired()) {
      throw new Error(
        `${CREDENTIALS_KEY_ENV} is not set; refusing to store a credential in plaintext ` +
          `(${CREDENTIALS_REQUIRED_ENV} is on, the default in production). See docs/runbook.md §9.`,
      );
    }
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
      {
        name: "AES-GCM",
        iv,
        additionalData: credentialAdditionalData("v2", current.id, field),
        tagLength: TAG_BYTES * 8,
      },
      current.key,
      new TextEncoder().encode(plaintext),
    ),
  );
  // WebCrypto appends the tag to the ciphertext; store it as its own segment.
  const ciphertext = sealed.subarray(0, sealed.length - TAG_BYTES);
  const tag = sealed.subarray(sealed.length - TAG_BYTES);
  return `${V2_PREFIX}${current.id}:${toBase64Url(iv)}:${toBase64Url(tag)}:${toBase64Url(ciphertext)}`;
}

/**
 * Decrypt the credential stored in `field`. Legacy plaintext (no `enc:`
 * prefix) is returned unchanged and v1 values decrypt without the row
 * binding, unless `STAGECRAFT_CREDENTIALS_ACCEPT_V1=false` refuses them.
 * Throws when an encrypted value can't be decrypted, including a v2 value
 * that was written for a different row or column.
 */
export async function decryptCredential(stored: string, field: CredentialField): Promise<string> {
  const format = credentialFormat(stored);
  if (format === "plaintext") return stored;
  if (format === "v1" && !credentialsAcceptV1()) {
    throw new Error(
      `Stored credential is in the legacy v1 format, which is not bound to its row; ` +
        `${CREDENTIALS_ACCEPT_V1_ENV}=false refuses it. Have the user reconnect (docs/runbook.md §9).`,
    );
  }
  const parts = encryptedSegments(stored, format);
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
      {
        name: "AES-GCM",
        iv,
        additionalData: credentialAdditionalData(format, keyId, field),
        tagLength: TAG_BYTES * 8,
      },
      key,
      sealed,
    );
  } catch {
    throw new Error(
      `Stored credential failed to decrypt with key "${keyId}" ` +
        `(wrong key, altered value, or a value moved from another row or column)`,
    );
  }
  return new TextDecoder().decode(plaintext);
}

/** Id of the key `encryptCredential` writes with, or null when none is set. */
export async function currentCredentialKeyId(): Promise<string | null> {
  return (await getKeyring()).current?.id ?? null;
}

/** Id of the key an encrypted value was written with; null for plaintext. */
export function credentialKeyId(stored: string): string | null {
  const format = credentialFormat(stored);
  if (format === "plaintext") return null;
  return encryptedSegments(stored, format)[0] ?? null;
}

/** `encryptCredential` that passes `null` / `undefined` through. */
export async function encryptOptionalCredential<T extends string | null | undefined>(
  value: T,
  field: CredentialField,
): Promise<T> {
  if (value === null || value === undefined) return value;
  return (await encryptCredential(value, field)) as T;
}

/** `decryptCredential` that passes `null` / `undefined` through. */
export async function decryptOptionalCredential<T extends string | null | undefined>(
  value: T,
  field: CredentialField,
): Promise<T> {
  if (value === null || value === undefined) return value;
  return (await decryptCredential(value, field)) as T;
}

/** Test hook: forget the cached keys and the one-time warning. */
export function resetCredentialCryptoForTests(): void {
  cachedKeyring = null;
  warnedMissingKey = false;
}
