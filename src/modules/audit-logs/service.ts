import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import type { Actor } from "../../lib/authorization.js";
import { isSuperAdmin } from "../../lib/authorization.js";
import { forbidden, notFound } from "../../lib/errors.js";
import type { ListAuditLogsQuery } from "./schemas.js";

function assertCanViewAudit(actor: Actor): void {
  if (!isSuperAdmin(actor)) {
    throw forbidden("Only Super Admin may view audit logs");
  }
}

function serialize(
  row: Prisma.AuditLogGetPayload<{
    include: {
      actor: {
        select: {
          id: true;
          email: true;
          firstName: true;
          lastName: true;
          role: { select: { code: true } };
        };
      };
    };
  }>,
) {
  return {
    id: row.id,
    actorId: row.actorId,
    actor: row.actor
      ? {
          id: row.actor.id,
          email: row.actor.email,
          firstName: row.actor.firstName,
          lastName: row.actor.lastName,
          roleCode: row.actor.role.code,
        }
      : null,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    metadata: row.metadata,
    createdAt: row.createdAt,
  };
}

export async function listAuditLogs(actor: Actor, query: ListAuditLogsQuery) {
  assertCanViewAudit(actor);

  const where: Prisma.AuditLogWhereInput = {
    AND: [
      ...(query.actorId ? [{ actorId: query.actorId }] : []),
      ...(query.action ? [{ action: query.action }] : []),
      ...(query.entityType ? [{ entityType: query.entityType }] : []),
      ...(query.entityId ? [{ entityId: query.entityId }] : []),
      ...(query.from || query.to
        ? [
            {
              createdAt: {
                ...(query.from ? { gte: query.from } : {}),
                ...(query.to ? { lte: query.to } : {}),
              },
            },
          ]
        : []),
      ...(query.search
        ? [
            {
              OR: [
                {
                  action: {
                    contains: query.search,
                    mode: "insensitive" as const,
                  },
                },
                {
                  entityType: {
                    contains: query.search,
                    mode: "insensitive" as const,
                  },
                },
                {
                  entityId: {
                    contains: query.search,
                    mode: "insensitive" as const,
                  },
                },
              ],
            },
          ]
        : []),
    ],
  };

  const [total, rows] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      orderBy: { createdAt: "desc" },
      include: {
        actor: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            role: { select: { code: true } },
          },
        },
      },
    }),
  ]);

  return {
    page: query.page,
    pageSize: query.pageSize,
    total,
    items: rows.map(serialize),
  };
}

export async function getAuditLog(actor: Actor, id: string) {
  assertCanViewAudit(actor);
  const row = await prisma.auditLog.findUnique({
    where: { id },
    include: {
      actor: {
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: { select: { code: true } },
        },
      },
    },
  });
  if (!row) throw notFound("Audit log not found");
  return serialize(row);
}

/** Distinct action/entityType values for filter dropdowns. */
export async function getAuditLogFacets(actor: Actor) {
  assertCanViewAudit(actor);
  const [actions, entityTypes] = await Promise.all([
    prisma.auditLog.findMany({
      distinct: ["action"],
      select: { action: true },
      orderBy: { action: "asc" },
      take: 200,
    }),
    prisma.auditLog.findMany({
      distinct: ["entityType"],
      select: { entityType: true },
      orderBy: { entityType: "asc" },
      take: 100,
    }),
  ]);
  return {
    actions: actions.map((a) => a.action),
    entityTypes: entityTypes.map((e) => e.entityType),
  };
}
