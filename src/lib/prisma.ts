import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

function createPrismaClient() {
  return new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["error", "warn"]
        : ["error"],
  });
}

/**
 * Keep a singleton, but rebuild if the process still holds a client from
 * before `prisma generate` (tsx watch won't reload this module automatically).
 */
function getPrismaClient(): PrismaClient {
  const existing = globalForPrisma.prisma;
  if (
    existing &&
    typeof (existing as { dailyWorkLog?: unknown }).dailyWorkLog !== "undefined"
  ) {
    return existing;
  }
  if (existing) {
    void existing.$disconnect().catch(() => undefined);
  }
  const client = createPrismaClient();
  globalForPrisma.prisma = client;
  return client;
}

/**
 * Proxy so each access uses a current client after `prisma generate`,
 * while preserving PrismaClient typings for the IDE and tsc.
 */
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const client = getPrismaClient();
    const value = Reflect.get(client, prop, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
}) as PrismaClient;

export async function disconnectPrisma(): Promise<void> {
  const client = globalForPrisma.prisma;
  if (client) {
    await client.$disconnect();
    globalForPrisma.prisma = undefined;
  }
}
