/** Helpers for reading `IntegrationAccount` rows, whose `provider` column Prisma types as `string`. */

import { isIntegrationProvider, type IntegrationProvider } from "./types";

/**
 * The set of providers the given integration rows connect. Rows whose
 * `provider` is not a known IntegrationProvider are ignored.
 */
export function connectedProviders(
  accounts: readonly { provider: string }[],
): Set<IntegrationProvider> {
  const connected = new Set<IntegrationProvider>();
  for (const { provider } of accounts) {
    if (isIntegrationProvider(provider)) connected.add(provider);
  }
  return connected;
}

/** The first integration row for `provider`, or undefined if none is connected. */
export function findIntegration<T extends { provider: string }>(
  accounts: readonly T[],
  provider: IntegrationProvider,
): T | undefined {
  return accounts.find((account) => account.provider === provider);
}
