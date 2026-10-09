import { PrismaClient } from "@prisma/client";
import { beginWrite, endWrite } from "./readCache.js";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

const WRITE_OPERATIONS = new Set([
  "create",
  "createMany",
  "createManyAndReturn",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "upsert",
  "delete",
  "deleteMany",
  "$executeRaw",
  "$executeRawUnsafe",
]);

/** Bulk writes report how many rows they touched; a no-op must not invalidate cached reads. */
function rowsChanged(result: unknown): boolean {
  if (typeof result === "number") return result > 0;
  if (Array.isArray(result)) return result.length > 0;
  if (result && typeof result === "object" && "count" in result) {
    return Number((result as { count: unknown }).count) > 0;
  }
  return true;
}

function createPrismaClient(): PrismaClient {
  const base = new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["error", "warn"]
        : ["error"],
  });
  return base.$extends({
    query: {
      async $allOperations({ model, operation, args, query }) {
        // Token rotation runs every few minutes per user and no GET response reads it.
        if (!WRITE_OPERATIONS.has(operation) || model === "RefreshToken") {
          return query(args);
        }
        beginWrite();
        let changed = true;
        try {
          const result = await query(args);
          changed = rowsChanged(result);
          return result;
        } finally {
          endWrite(changed);
        }
      },
    },
  }) as unknown as PrismaClient;
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
    if (prop === "$transaction" && typeof value === "function") {
      // Writes inside an interactive transaction become visible only at commit.
      return async (...args: unknown[]) => {
        beginWrite();
        try {
          return await (value as (...a: unknown[]) => Promise<unknown>).apply(client, args);
        } finally {
          endWrite(true);
        }
      };
    }
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
