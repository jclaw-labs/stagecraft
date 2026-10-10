/**
 * encrypt-credentials.ts — backfill that brings every stored integration
 * credential to the current format (issues #354 and #370, ADR-005):
 *
 *   Account.access_token / refresh_token / id_token
 *   IntegrationAccount.accessToken / refreshToken
 *
 * - Plaintext values are encrypted in the row-bound `enc:v2:` format.
 * - Legacy `enc:v1:` values (encrypted, but not bound to their row) are
 *   decrypted and re-encrypted as v2 under the current key, but only with
 *   `--upgrade-v1`. Without it they are left as they are and counted on
 *   their own (`v1LeftAsIs`, not `undecryptable`: nothing is wrong with
 *   their key), so a v1 copy pasted into another row after the v1 cut-off
 *   isn't re-bound to that row by a later run (a `--rotate`, a re-run)
 *   whatever the operator's shell has for STAGECRAFT_CREDENTIALS_ACCEPT_V1.
 *   With `--upgrade-v1`, STAGECRAFT_CREDENTIALS_ACCEPT_V1=false still
 *   refuses them, and they are counted the same way.
 * - `enc:v2:` values are left alone, unless `--rotate` is given and they are
 *   under an older key, in which case they are re-encrypted with the
 *   current one, after which that old key can be dropped from
 *   STAGECRAFT_CREDENTIALS_OLD_KEYS.
 *
 * Safe to re-run: a second run finds only v2 values and changes nothing.
 * Each update only applies if the column still holds the value that was
 * read, so a token rewritten by a sign-in mid-run is left alone (and
 * counted as a conflict) rather than overwritten.
 *
 * Every already-encrypted value is test-decrypted. One that can't be (its
 * key isn't configured, it's malformed, or a v2 value sits in a row it
 * wasn't written for) is logged by row and column, counted as undecryptable
 * and skipped, so the rest of the run still happens; the run then exits
 * non-zero. So does a v1 value left as it is, and an `IntegrationAccount`
 * row whose `provider` isn't a known provider, since its values can't be
 * bound to it.
 *
 * Usage, from the repo root, with DATABASE_URL and STAGECRAFT_CREDENTIALS_KEY
 * (plus STAGECRAFT_CREDENTIALS_OLD_KEYS if any) exported with the deployed
 * values (docs/runbook.md §9 shows how without putting them in history):
 *
 *   npx tsx apps/web/scripts/encrypt-credentials.ts [--dry-run] [--rotate] [--upgrade-v1]
 */
import { pathToFileURL } from "node:url";
import type { PrismaClient } from "@stagecraft/db";
import { isIntegrationProvider } from "@stagecraft/shared";
import {
  ACCOUNT_TOKEN_COLUMNS,
  CREDENTIALS_ACCEPT_V1_ENV,
  CREDENTIALS_KEY_ENV,
  CREDENTIALS_OLD_KEYS_ENV,
  INTEGRATION_TOKEN_COLUMNS,
  credentialFormat,
  credentialKeyId,
  credentialsAcceptV1,
  currentCredentialKeyId,
  decryptCredential,
  encryptCredential,
  integrationCredentialField,
  type AccountTokenColumn,
  type CredentialField,
  type IntegrationTokenColumn,
} from "../src/lib/credential-crypto";

export type CredentialStore = Pick<PrismaClient, "account" | "integrationAccount">;

export interface BackfillOptions {
  dryRun?: boolean;
  rotate?: boolean;
  /** Re-encrypt legacy v1 values as v2. Off by default: see the file comment. */
  upgradeV1?: boolean;
  batchSize?: number;
  log?: (line: string) => void;
}

export interface TableStats {
  rowsScanned: number;
  /** Plaintext values encrypted as v2. */
  valuesEncrypted: number;
  /** Legacy v1 values re-encrypted as v2. */
  valuesUpgraded: number;
  /** v2 values re-encrypted under the current key (`--rotate`). */
  valuesRotated: number;
  /** v2 values left as they are. */
  valuesAlreadyEncrypted: number;
  /**
   * Legacy v1 values left as they are: run without `--upgrade-v1`, or with
   * STAGECRAFT_CREDENTIALS_ACCEPT_V1=false. Counted apart from
   * `undecryptable` so a skipped upgrade doesn't read as a missing key.
   */
  v1LeftAsIs: number;
  undecryptable: number;
  /** Values in rows whose `provider` isn't known, so they can't be bound. */
  unbindable: number;
  conflicts: number;
}

export interface BackfillStats {
  account: TableStats;
  integrationAccount: TableStats;
}

type WriteKind = "valuesEncrypted" | "valuesUpgraded" | "valuesRotated";

const DEFAULT_BATCH_SIZE = 200;

function emptyStats(): TableStats {
  return {
    rowsScanned: 0,
    valuesEncrypted: 0,
    valuesUpgraded: 0,
    valuesRotated: 0,
    valuesAlreadyEncrypted: 0,
    v1LeftAsIs: 0,
    undecryptable: 0,
    unbindable: 0,
    conflicts: 0,
  };
}

interface RowPlan<C extends string> {
  data: Partial<Record<C, string>>;
  expected: Partial<Record<C, string>>;
  writes: WriteKind[];
}

/**
 * Work out the new values for one row's token columns. Returns only the
 * columns that change, plus the values they held when read (for the
 * compare-and-set `where`).
 */
async function planRow<C extends AccountTokenColumn | IntegrationTokenColumn>(
  row: { id: string } & Record<C, string | null>,
  columns: readonly C[],
  fieldFor: (column: C) => CredentialField | null,
  currentKeyId: string,
  rotate: boolean,
  upgradeV1: boolean,
  stats: TableStats,
  report: (line: string) => void,
): Promise<RowPlan<C> | null> {
  const plan: RowPlan<C> = { data: {}, expected: {}, writes: [] };
  for (const column of columns) {
    const value = row[column];
    if (value === null || value === undefined) continue;
    const field = fieldFor(column);
    if (!field) {
      stats.unbindable++;
      report(`${row.id}.${column}: unknown provider, cannot bind the value to its row`);
      continue;
    }
    let kind: WriteKind;
    let plaintext: string;
    try {
      const format = credentialFormat(value);
      if (format === "v1" && !upgradeV1) {
        // Checked before decrypting: an unbound v1 value decrypts in any row.
        // Worded so it doesn't read as "re-run with the flag": after runbook
        // §9 step 5 that would bind a pasted copy to the row it sits in.
        stats.v1LeftAsIs++;
        report(
          `${row.id}.${column}: legacy v1 value, left as is. Upgrading it is for ` +
            `"Upgrading from v1" before runbook §9 step 5 only; after step 5, have the user reconnect`,
        );
        continue;
      }
      if (format === "v1" && !credentialsAcceptV1()) {
        stats.v1LeftAsIs++;
        report(
          `${row.id}.${column}: legacy v1 value, left as is: ${CREDENTIALS_ACCEPT_V1_ENV}=false ` +
            `refuses it. Have the user reconnect (docs/runbook.md §9)`,
        );
        continue;
      }
      plaintext = await decryptCredential(value, field);
      if (format === "plaintext") {
        kind = "valuesEncrypted";
      } else if (format === "v1") {
        kind = "valuesUpgraded";
      } else if (rotate && credentialKeyId(value) !== currentKeyId) {
        kind = "valuesRotated";
      } else {
        stats.valuesAlreadyEncrypted++;
        continue;
      }
    } catch (error) {
      // The error names only the key id, never key material or the value.
      stats.undecryptable++;
      report(`${row.id}.${column}: cannot decrypt (${error instanceof Error ? error.message : String(error)})`);
      continue;
    }
    plan.data[column] = await encryptCredential(plaintext, field);
    plan.expected[column] = value;
    plan.writes.push(kind);
    stats[kind]++;
  }
  return plan.writes.length > 0 ? plan : null;
}

async function backfillTable<
  C extends AccountTokenColumn | IntegrationTokenColumn,
  R extends { id: string } & Record<C, string | null>,
>(args: {
  name: string;
  columns: readonly C[];
  fetchBatch: (afterId: string | null, take: number) => Promise<R[]>;
  fieldFor: (row: R, column: C) => CredentialField | null;
  update: (id: string, expected: Partial<Record<C, string>>, data: Partial<Record<C, string>>) => Promise<number>;
  currentKeyId: string;
  options: BackfillOptions;
}): Promise<TableStats> {
  const { name, columns, fetchBatch, fieldFor, update, currentKeyId, options } = args;
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const log = options.log ?? (() => {});
  const stats = emptyStats();
  let afterId: string | null = null;
  for (;;) {
    const rows = await fetchBatch(afterId, batchSize);
    if (rows.length === 0) break;
    for (const row of rows) {
      stats.rowsScanned++;
      const plan = await planRow(
        row,
        columns,
        (column) => fieldFor(row, column),
        currentKeyId,
        options.rotate ?? false,
        options.upgradeV1 ?? false,
        stats,
        (line) => log(`${name} ${line}`),
      );
      if (!plan || options.dryRun) continue;
      const count = await update(row.id, plan.expected, plan.data);
      if (count === 0) {
        // The row changed (or went away) since it was read; whatever wrote
        // it went through the app, which encrypts on write.
        stats.conflicts++;
        for (const kind of plan.writes) stats[kind]--;
        log(`${name} ${row.id}: changed during the run, left as is`);
      }
    }
    afterId = rows[rows.length - 1].id;
    if (rows.length < batchSize) break;
  }
  log(
    `${name}: ${stats.rowsScanned} rows, ${stats.valuesEncrypted} plaintext encrypted, ` +
      `${stats.valuesUpgraded} v1 upgraded to v2, ${stats.valuesRotated} rotated, ` +
      `${stats.valuesAlreadyEncrypted} already v2, ${stats.v1LeftAsIs} v1 left as is, ` +
      `${stats.undecryptable} undecryptable, ` +
      `${stats.unbindable} unbindable, ${stats.conflicts} conflicts` +
      (options.dryRun ? " (dry run: nothing written)" : ""),
  );
  return stats;
}

/**
 * Bring every credential in `Account` and `IntegrationAccount` to v2:
 * encrypt plaintext, with `upgradeV1` upgrade v1, and with `rotate` re-key
 * old v2 values.
 */
export async function encryptStoredCredentials(
  db: CredentialStore,
  options: BackfillOptions = {},
): Promise<BackfillStats> {
  const currentKeyId = await currentCredentialKeyId();
  if (!currentKeyId) {
    // encryptCredential would hand back plaintext (or throw); refuse up
    // front instead of "succeeding" without encrypting anything.
    throw new Error(`${CREDENTIALS_KEY_ENV} is not set; nothing would be encrypted`);
  }
  // Read the flag once up front: a typo throws its own configuration error
  // here, instead of inside a row's decrypt, where it would be counted as
  // undecryptable and blamed on a missing key.
  credentialsAcceptV1();

  const account = await backfillTable({
    name: "Account",
    columns: ACCOUNT_TOKEN_COLUMNS,
    currentKeyId,
    options,
    fetchBatch: (afterId, take) =>
      db.account.findMany({
        where: afterId ? { id: { gt: afterId } } : undefined,
        orderBy: { id: "asc" },
        take,
        select: {
          id: true,
          provider: true,
          providerAccountId: true,
          access_token: true,
          refresh_token: true,
          id_token: true,
        },
      }),
    fieldFor: (row, column) => ({
      table: "Account",
      provider: row.provider,
      providerAccountId: row.providerAccountId,
      column,
    }),
    update: async (id, expected, data) =>
      (await db.account.updateMany({ where: { id, ...expected }, data })).count,
  });

  const integrationAccount = await backfillTable({
    name: "IntegrationAccount",
    columns: INTEGRATION_TOKEN_COLUMNS,
    currentKeyId,
    options,
    fetchBatch: (afterId, take) =>
      db.integrationAccount.findMany({
        where: afterId ? { id: { gt: afterId } } : undefined,
        orderBy: { id: "asc" },
        take,
        select: { id: true, userId: true, provider: true, accessToken: true, refreshToken: true },
      }),
    fieldFor: (row, column) =>
      isIntegrationProvider(row.provider)
        ? integrationCredentialField(row.userId, row.provider, column)
        : null,
    update: async (id, expected, data) =>
      (await db.integrationAccount.updateMany({ where: { id, ...expected }, data })).count,
  });

  return { account, integrationAccount };
}

/**
 * Fail the run when any stored value couldn't be decrypted, was a v1 value
 * left as it is, or couldn't be bound to its row, after the per-row lines
 * naming them have been logged.
 */
export function assertAllDecryptable(stats: BackfillStats): void {
  const undecryptable = stats.account.undecryptable + stats.integrationAccount.undecryptable;
  if (undecryptable > 0) {
    throw new Error(
      `${undecryptable} stored value(s) could not be decrypted (listed above); ` +
        `configure their key in ${CREDENTIALS_OLD_KEYS_ENV} or have those users reconnect`,
    );
  }
  const v1LeftAsIs = stats.account.v1LeftAsIs + stats.integrationAccount.v1LeftAsIs;
  if (v1LeftAsIs > 0) {
    throw new Error(
      `${v1LeftAsIs} legacy v1 value(s) were left as they are (listed above). ` +
        `Before runbook §9 step 5 they are upgraded by "Upgrading from v1"; after it, have those users reconnect`,
    );
  }
  const unbindable = stats.account.unbindable + stats.integrationAccount.unbindable;
  if (unbindable > 0) {
    throw new Error(
      `${unbindable} stored value(s) are in rows with an unknown provider (listed above) and were left as they are`,
    );
  }
}

/** CLI entry point: parse flags, run the backfill against `@stagecraft/db`, fail on undecryptable values. */
export async function main(argv: string[]): Promise<void> {
  const known = new Set(["--dry-run", "--rotate", "--upgrade-v1"]);
  const unknown = argv.filter((arg) => !known.has(arg));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown argument(s): ${unknown.join(" ")}. Usage: [--dry-run] [--rotate] [--upgrade-v1]`,
    );
  }
  const { prisma } = await import("@stagecraft/db");
  try {
    const stats = await encryptStoredCredentials(prisma, {
      dryRun: argv.includes("--dry-run"),
      rotate: argv.includes("--rotate"),
      upgradeV1: argv.includes("--upgrade-v1"),
      log: (line) => console.log(line),
    });
    assertAllDecryptable(stats);
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
