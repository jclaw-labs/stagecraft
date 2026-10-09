import { PrismaClient } from "@prisma/client";
import { hasGlobalWebSocket, prismaClientOptions } from "./client-options";

function createPrismaClient(): PrismaClient {
  return new PrismaClient(prismaClientOptions(process.env, hasGlobalWebSocket()));
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
