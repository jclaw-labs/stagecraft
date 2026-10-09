/**
 * encrypt-credentials.ts — one-off backfill that encrypts the integration
 * credentials already stored in plaintext (issue #354, ADR-005):
 *
 *   Account.access_token / refresh_token / id_token
 *   IntegrationAccount.accessToken / refreshToken
 *
 * Safe to re-run: values already in the `enc:v1:` format are skipped, and
 * each update only applies if the column still holds the value that was
 * read, so a token rewritten by a sign-in mid-run is left alone (and counted
 * as a conflict) rather than overwritten.
 *
 * With `--rotate`, values encrypted under an older key are also re-encrypted
 * with the current one, after which that old key can be dropped from
 * STAGECRAFT_CREDENTIALS_OLD_KEYS.
 *
 * Usage, from the repo root, with DATABASE_URL and STAGECRAFT_CREDENTIALS_KEY
 * (plus STAGECRAFT_CREDENTIALS_OLD_KEYS if any) set to the deployed values:
 *
 *   npx tsx apps/web/scripts/encrypt-credentials.ts [--dry-run] [--rotate]
 *
 * Order of operations is in docs/runbook.md ("Credential encryption key").
 */
import { pathToFileURL } from "node:url";
import type { PrismaClient } from "@stagecraft/db";
import {
  CREDENTIALS_KEY_ENV,
  credentialKeyId,
  currentCredentialKeyId,
  decryptCredential,
  encryptCredential,
  isEncryptedCredential,
} from "../src/lib/credential-crypto";

export const ACCOUNT_TOKEN_FIELDS = ["access_token", "refresh_token", "id_token"] as const;
export const INTEGRATION_TOKEN_FIELDS = ["accessToken", "refreshToken"] as const;

type AccountTokenField = (typeof ACCOUNT_TOKEN_FIELDS)[number];
type IntegrationTokenField = (typeof INTEGRATION_TOKEN_FIELDS)[number];

export type CredentialStore = Pick<PrismaClient, "account" | "integrationAccount">;

export interface BackfillOptions {
  dryRun?: boolean;
  rotate?: boolean;
  batchSize?: number;
  log?: (line: string) => void;
}

export interface TableStats {
  rowsScanned: number;
  valuesEncrypted: number;
  valuesAlreadyEncrypted: number;
  conflicts: number;
}

export interface BackfillStats {
  account: TableStats;
  integrationAccount: TableStats;
}

const DEFAULT_BATCH_SIZE = 200;

function emptyStats(): TableStats {
  return { rowsScanned: 0, valuesEncrypted: 0, valuesAlreadyEncrypted: 0, conflicts: 0 };
}

/**
 * Work out the new values for one row's token columns. Returns only the
 * columns that change, plus the values they held when read (for the
 * compare-and-set `where`).
 */
async function planRow<F extends string>(
  row: Record<F, string | null>,
  fields: readonly F[],
  currentKeyId: string,
  rotate: boolean,
  stats: TableStats,
): Promise<{ data: Partial<Record<F, string>>; expected: Partial<Record<F, string>> } | null> {
  const data: Partial<Record<F, string>> = {};
  const expected: Partial<Record<F, string>> = {};
  let changed = false;
  for (const field of fields) {
    const value = row[field];
    if (value === null || value === undefined) continue;
    if (isEncryptedCredential(value)) {
      if (!rotate || credentialKeyId(value) === currentKeyId) {
        stats.valuesAlreadyEncrypted++;
        continue;
      }
      data[field] = await encryptCredential(await decryptCredential(value));
    } else {
      data[field] = await encryptCredential(value);
    }
    expected[field] = value;
    stats.valuesEncrypted++;
    changed = true;
  }
  return changed ? { data, expected } : null;
}

async function backfillTable<F extends AccountTokenField | IntegrationTokenField>(args: {
  name: string;
  fields: readonly F[];
  fetchBatch: (afterId: string | null, take: number) => Promise<Array<{ id: string } & Record<F, string | null>>>;
  update: (id: string, expected: Partial<Record<F, string>>, data: Partial<Record<F, string>>) => Promise<number>;
  currentKeyId: string;
  options: BackfillOptions;
}): Promise<TableStats> {
  const { name, fields, fetchBatch, update, currentKeyId, options } = args;
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const log = options.log ?? (() => {});
  const stats = emptyStats();
  let afterId: string | null = null;
  for (;;) {
    const rows = await fetchBatch(afterId, batchSize);
    if (rows.length === 0) break;
    for (const row of rows) {
      stats.rowsScanned++;
      const plan = await planRow(row, fields, currentKeyId, options.rotate ?? false, stats);
      if (!plan || options.dryRun) continue;
      const count = await update(row.id, plan.expected, plan.data);
      if (count === 0) {
        // The row changed (or went away) since it was read; whatever wrote
        // it went through the app, which encrypts on write.
        stats.conflicts++;
        stats.valuesEncrypted -= Object.keys(plan.data).length;
        log(`${name} ${row.id}: changed during the run, left as is`);
      }
    }
    afterId = rows[rows.length - 1].id;
    if (rows.length < batchSize) break;
  }
  log(
    `${name}: ${stats.rowsScanned} rows, ${stats.valuesEncrypted} values ` +
      `${options.dryRun ? "to encrypt" : "encrypted"}, ${stats.valuesAlreadyEncrypted} already encrypted, ` +
      `${stats.conflicts} conflicts`,
  );
  return stats;
}

/** Encrypt every plaintext credential in `Account` and `IntegrationAccount`. */
export async function encryptStoredCredentials(
  db: CredentialStore,
  options: BackfillOptions = {},
): Promise<BackfillStats> {
  const currentKeyId = await currentCredentialKeyId();
  if (!currentKeyId) {
    // encryptCredential would hand back plaintext; refuse instead of
    // "succeeding" without encrypting anything.
    throw new Error(`${CREDENTIALS_KEY_ENV} is not set; nothing would be encrypted`);
  }

  const account = await backfillTable({
    name: "Account",
    fields: ACCOUNT_TOKEN_FIELDS,
    currentKeyId,
    options,
    fetchBatch: (afterId, take) =>
      db.account.findMany({
        where: afterId ? { id: { gt: afterId } } : undefined,
        orderBy: { id: "asc" },
        take,
        select: { id: true, access_token: true, refresh_token: true, id_token: true },
      }),
    update: async (id, expected, data) =>
      (await db.account.updateMany({ where: { id, ...expected }, data })).count,
  });

  const integrationAccount = await backfillTable({
    name: "IntegrationAccount",
    fields: INTEGRATION_TOKEN_FIELDS,
    currentKeyId,
    options,
    fetchBatch: (afterId, take) =>
      db.integrationAccount.findMany({
        where: afterId ? { id: { gt: afterId } } : undefined,
        orderBy: { id: "asc" },
        take,
        select: { id: true, accessToken: true, refreshToken: true },
      }),
    update: async (id, expected, data) =>
      (await db.integrationAccount.updateMany({ where: { id, ...expected }, data })).count,
  });

  return { account, integrationAccount };
}

async function main(argv: string[]): Promise<void> {
  const known = new Set(["--dry-run", "--rotate"]);
  const unknown = argv.filter((arg) => !known.has(arg));
  if (unknown.length > 0) {
    throw new Error(`Unknown argument(s): ${unknown.join(" ")}. Usage: [--dry-run] [--rotate]`);
  }
  const { prisma } = await import("@stagecraft/db");
  try {
    await encryptStoredCredentials(prisma, {
      dryRun: argv.includes("--dry-run"),
      rotate: argv.includes("--rotate"),
      log: (line) => console.log(line),
    });
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
