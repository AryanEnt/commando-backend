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

  const code = await resolveUniqueActivityCode(input.code, input.name);

  const created = await prisma.activityType.create({
    data: {
      code,
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

/** UPPER_SNAKE from display name, unique against existing codes. */
function slugifyActivityCode(name: string): string {
  const raw = name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
  let code = raw || "ACTIVITY";
  if (!/^[A-Z]/.test(code)) code = `A_${code}`;
  return code.slice(0, 64);
}

async function resolveUniqueActivityCode(
  explicit: string | undefined,
  name: string,
): Promise<string> {
  const base = explicit?.trim()
    ? explicit.trim().toUpperCase()
    : slugifyActivityCode(name);

  const existing = await prisma.activityType.findUnique({ where: { code: base } });
  if (!existing) return base;
  if (explicit?.trim()) {
    throw conflict("Activity type code already exists");
  }

  for (let i = 2; i < 1000; i++) {
    const suffix = `_${i}`;
    const candidate = `${base.slice(0, Math.max(1, 64 - suffix.length))}${suffix}`;
    const hit = await prisma.activityType.findUnique({ where: { code: candidate } });
    if (!hit) return candidate;
  }
  throw conflict("Could not generate a unique activity type code");
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

/**
 * Permanently delete unused activity types.
 * If Daily Log entries reference it, deactivate/archive instead.
 */
export async function deleteActivityType(actor: Actor, id: string) {
  if (!hasPermission(actor, PERMISSIONS.ACTIVITY_TYPE_MANAGE)) {
    throw forbidden("Not allowed to manage activity types");
  }

  const existing = await prisma.activityType.findUnique({ where: { id } });
  if (!existing) throw notFound("Activity type not found");

  const usage = await prisma.dailyLogEntry.count({
    where: { activityTypeId: id },
  });

  if (usage > 0) {
    const updated = await prisma.activityType.update({
      where: { id },
      data: { isActive: false, archivedAt: new Date() },
    });
    await prisma.auditLog.create({
      data: {
        actorId: actor.id,
        action: "ACTIVITY_TYPE_ARCHIVED",
        entityType: "ActivityType",
        entityId: updated.id,
        metadata: { reason: "delete_requested_with_history", usage },
      },
    });
    return {
      deleted: false as const,
      archived: true as const,
      activityType: updated,
      message: `This activity type was used in ${usage} Daily Log entr${usage === 1 ? "y" : "ies"}, so it was deactivated instead of permanently deleted.`,
    };
  }

  await prisma.activityType.delete({ where: { id } });

  await prisma.auditLog.create({
    data: {
      actorId: actor.id,
      action: "ACTIVITY_TYPE_DELETED",
      entityType: "ActivityType",
      entityId: id,
      metadata: { code: existing.code, name: existing.name },
    },
  });

  return {
    deleted: true as const,
    archived: false as const,
    activityType: null,
    message: "Activity type deleted",
  };
}
