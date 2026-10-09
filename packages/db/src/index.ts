import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { resolveDatabaseDriver } from "./driver";

function createPrismaClient(): PrismaClient {
  const log: ("query" | "error" | "warn")[] =
    process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"];
  const databaseUrl = process.env.DATABASE_URL;
  const driver = resolveDatabaseDriver({
    databaseUrl,
    override: process.env.DATABASE_DRIVER,
    hasWebSocket: typeof globalThis.WebSocket === "function",
  });

  if (driver === "neon") {
    return new PrismaClient({
      adapter: new PrismaNeon({ connectionString: databaseUrl }),
      log,
    });
  }
  return new PrismaClient({ log });
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export { PrismaClient };
export type * from "@prisma/client";
export { DATABASE_DRIVERS, isNeonUrl, resolveDatabaseDriver } from "./driver";
export type { DatabaseDriver } from "./driver";
