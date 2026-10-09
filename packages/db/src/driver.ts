/**
 * Picks how the Prisma client reaches Postgres.
 *
 * - `neon`: Prisma's Neon driver adapter (`@prisma/adapter-neon`), which talks
 *   to Neon over WebSockets. It runs anywhere a global `WebSocket` exists,
 *   including Cloudflare Workers, where Prisma's default engine connection
 *   can't open a TCP socket.
 * - `engine`: Prisma's built-in TCP connection. Used for local dev, tests and
 *   docker-compose Postgres, which the Neon adapter can't reach.
 *
 * By default the driver follows `DATABASE_URL`: a `*.neon.tech` host gets the
 * adapter, anything else gets the engine. `DATABASE_DRIVER` overrides that,
 * e.g. `DATABASE_DRIVER=engine` to put a Neon deployment back on the engine
 * without a code change.
 */
export const DATABASE_DRIVERS = ["neon", "engine"] as const;

export type DatabaseDriver = (typeof DATABASE_DRIVERS)[number];

export interface ResolveDatabaseDriverInput {
  /** The connection string Prisma will use (`DATABASE_URL`). */
  databaseUrl: string | undefined;
  /** Raw `DATABASE_DRIVER` value; empty or unset means "follow the URL". */
  override: string | undefined;
  /** Whether the runtime has a global `WebSocket` (Node 22+, Workers). */
  hasWebSocket: boolean;
}

function isDatabaseDriver(value: string): value is DatabaseDriver {
  return (DATABASE_DRIVERS as readonly string[]).includes(value);
}

/** True when the connection string points at a Neon-hosted database. */
export function isNeonUrl(databaseUrl: string | undefined): boolean {
  if (!databaseUrl) return false;
  let hostname: string;
  try {
    hostname = new URL(databaseUrl).hostname.toLowerCase();
  } catch {
    return false;
  }
  return hostname === "neon.tech" || hostname.endsWith(".neon.tech");
}

export function resolveDatabaseDriver({
  databaseUrl,
  override,
  hasWebSocket,
}: ResolveDatabaseDriverInput): DatabaseDriver {
  const requested = override?.trim().toLowerCase();

  if (requested) {
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

  // Without a global WebSocket the Neon adapter can't connect, so keep the
  // engine rather than fail at the first query.
  return isNeonUrl(databaseUrl) && hasWebSocket ? "neon" : "engine";
}
