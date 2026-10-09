import type { Prisma } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { resolveDatabaseDriver } from "./driver";

/** The environment variables `prismaClientOptions` reads. */
export interface PrismaClientEnv {
  DATABASE_URL?: string;
  DATABASE_DRIVER?: string;
  NODE_ENV?: string;
}

export interface PrismaClientOptionsResult {
  /** Set only when `DATABASE_DRIVER=neon`; absent means Prisma's TCP engine. */
  adapter?: PrismaNeon;
  log: Prisma.LogLevel[];
}

/** Whether the runtime has a global `WebSocket` (Node 22+, Workers). */
export function hasGlobalWebSocket(): boolean {
  return typeof globalThis.WebSocket === "function";
}

/**
 * Builds the `PrismaClient` constructor options from the environment. Pure so
 * the driver wiring can be tested without constructing a client.
 */
export function prismaClientOptions(
  env: PrismaClientEnv,
  hasWebSocket: boolean,
): PrismaClientOptionsResult {
  const log: Prisma.LogLevel[] =
    env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"];
  const driver = resolveDatabaseDriver({
    databaseUrl: env.DATABASE_URL,
    override: env.DATABASE_DRIVER,
    hasWebSocket,
  });

  if (driver === "neon") {
    return { adapter: new PrismaNeon({ connectionString: env.DATABASE_URL }), log };
  }
  return { log };
}
