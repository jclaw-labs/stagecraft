/**
 * Picks how the Prisma client reaches Postgres.
 *
 * - `engine` (default): Prisma's built-in TCP connection. Used for local dev,
 *   tests, docker-compose Postgres and every deployment that doesn't opt in.
 * - `neon`: Prisma's Neon driver adapter (`@prisma/adapter-neon`), which talks
 *   to Neon over WebSockets. It runs anywhere a global `WebSocket` exists,
 *   including Cloudflare Workers, where Prisma's default engine connection
 *   can't open a TCP socket.
 *
 * The adapter is opt-in: set `DATABASE_DRIVER=neon` to use it. Unset, empty or
 * `engine` keeps the built-in engine.
 */
export const DATABASE_DRIVERS = ["neon", "engine"] as const;

export type DatabaseDriver = (typeof DATABASE_DRIVERS)[number];

export interface ResolveDatabaseDriverInput {
  /** The connection string Prisma will use (`DATABASE_URL`). */
  databaseUrl: string | undefined;
  /** Raw `DATABASE_DRIVER` value; empty or unset means `engine`. */
  override: string | undefined;
  /** Whether the runtime has a global `WebSocket` (Node 22+, Workers). */
  hasWebSocket: boolean;
}

function isDatabaseDriver(value: string): value is DatabaseDriver {
  return (DATABASE_DRIVERS as readonly string[]).includes(value);
}

export function resolveDatabaseDriver({
  databaseUrl,
  override,
  hasWebSocket,
}: ResolveDatabaseDriverInput): DatabaseDriver {
  const requested = override?.trim().toLowerCase();
  if (!requested) return "engine";

  if (!isDatabaseDriver(requested)) {
    throw new Error(
      `DATABASE_DRIVER must be one of ${DATABASE_DRIVERS.join(", ")}; got "${override}".`,
    );
  }
  if (requested === "neon") {
    if (!databaseUrl) {
      throw new Error("DATABASE_DRIVER=neon needs DATABASE_URL to be set.");
    }
    if (!hasWebSocket) {
      throw new Error(
        "DATABASE_DRIVER=neon needs a global WebSocket (Node 22+ or Cloudflare Workers).",
      );
    }
  }
  return requested;
}
