import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import type { Actor } from "../../lib/authorization.js";
import { isSuperAdmin } from "../../lib/authorization.js";
import { conflict, forbidden, notFound } from "../../lib/errors.js";
import { hasPermission } from "../../lib/authorization.js";
import { PERMISSIONS } from "../../lib/permissions.js";
import {
  paginationMeta,
  prismaPageArgs,
} from "../../lib/pagination.js";
import type { z } from "zod";
import type {
  createActivityTypeSchema,
  listActivityTypesQuerySchema,
  updateActivityTypeSchema,
} from "./schemas.js";

type CreateInput = z.infer<typeof createActivityTypeSchema>;
type UpdateInput = z.infer<typeof updateActivityTypeSchema>;
type ListQuery = z.infer<typeof listActivityTypesQuerySchema>;

export async function listActivityTypes(actor: Actor, query: ListQuery) {
  const canManage = hasPermission(actor, PERMISSIONS.ACTIVITY_TYPE_MANAGE);
  const includeInactive = Boolean(query.includeInactive && canManage);

  const where: Prisma.ActivityTypeWhereInput = {
    ...(includeInactive ? {} : { isActive: true, archivedAt: null }),
    ...(query.search
      ? {
          OR: [
            { code: { contains: query.search, mode: "insensitive" } },
            { name: { contains: query.search, mode: "insensitive" } },
            { description: { contains: query.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  // Form catalogs: return a large active page without forcing admin pagination UX.
  const pageSize = query.catalog
    ? Math.min(query.pageSize || 100, 100)
    : query.pageSize;
  const page = query.catalog ? 1 : query.page;
  const { skip, take } = prismaPageArgs(page, pageSize);

  const [total, activityTypes] = await Promise.all([
    prisma.activityType.count({ where }),
    prisma.activityType.findMany({
      where,
      orderBy: { name: "asc" },
      skip,
      take,
    }),
  ]);

  return {
    activityTypes,
    ...paginationMeta(page, pageSize, total),
  };
}

export async function createActivityType(actor: Actor, input: CreateInput) {
  if (!isSuperAdmin(actor) && !hasPermission(actor, PERMISSIONS.ACTIVITY_TYPE_MANAGE)) {
    throw forbidden("Not allowed to manage activity types");
  }

  const existing = await prisma.activityType.findUnique({
    where: { code: input.code },
  });
  if (existing) throw conflict("Activity type code already exists");

  const created = await prisma.activityType.create({
    data: {
      code: input.code,
      name: input.name,
      description: input.description ?? null,
      isActive: input.isActive ?? true,
    },
  });

  await prisma.auditLog.create({
    data: {
      actorId: actor.id,
      action: "ACTIVITY_TYPE_CREATED",
      entityType: "ActivityType",
      entityId: created.id,
      metadata: { code: created.code },
    },
  });

  return created;
}

export async function updateActivityType(
  actor: Actor,
  id: string,
  input: UpdateInput,
) {
  if (!hasPermission(actor, PERMISSIONS.ACTIVITY_TYPE_MANAGE)) {
    throw forbidden("Not allowed to manage activity types");
  }

  const existing = await prisma.activityType.findUnique({ where: { id } });
  if (!existing) throw notFound("Activity type not found");

  const updated = await prisma.activityType.update({
    where: { id },
    data: {
      name: input.name,
      description: input.description,
      isActive: input.isActive,
      archivedAt:
        input.archivedAt === undefined ? undefined : input.archivedAt,
    },
  });

  await prisma.auditLog.create({
    data: {
      actorId: actor.id,
      action: "ACTIVITY_TYPE_UPDATED",
      entityType: "ActivityType",
      entityId: updated.id,
      metadata: {
        isActive: updated.isActive,
        archivedAt: updated.archivedAt,
      },
    },
  });

  return updated;
}
