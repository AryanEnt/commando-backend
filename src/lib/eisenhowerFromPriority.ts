import type {
  EventImportance,
  EventUrgency,
} from "@prisma/client";
import { prisma } from "./prisma.js";
import { writeAuditLog } from "./audit.js";
import { eisenhowerCategoryFrom } from "./workspaceEvents.js";

function currentMonthStartUtc(): Date {
  const now = new Date();
  // Match frontend YYYY-MM (local calendar month), stored as UTC date
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
}

/**
 * Creates a current-month Eisenhower matrix task from urgency/importance.
 */
export async function createEisenhowerTaskFromPriority(input: {
  salesExecutiveProfileId: string;
  assignmentId?: string | null;
  title: string;
  notes?: string | null;
  urgency: EventUrgency;
  importance: EventImportance;
  createdById: string;
  via?: string;
}): Promise<{ id: string; category: ReturnType<typeof eisenhowerCategoryFrom> }> {
  const category = eisenhowerCategoryFrom(input.urgency, input.importance);
  const created = await prisma.eisenhowerTask.create({
    data: {
      salesExecutiveProfileId: input.salesExecutiveProfileId,
      assignmentId: input.assignmentId ?? null,
      month: currentMonthStartUtc(),
      category,
      title: input.title.trim().slice(0, 240),
      notes: input.notes?.trim() ? input.notes.trim().slice(0, 10000) : null,
      status: "OPEN",
      createdById: input.createdById,
    },
    select: { id: true },
  });

  await writeAuditLog({
    actorId: input.createdById,
    action: "EISENHOWER_TASK_CREATED",
    entityType: "EisenhowerTask",
    entityId: created.id,
    metadata: {
      profileId: input.salesExecutiveProfileId,
      category,
      via: input.via ?? "PRIORITY",
    },
  });

  return { id: created.id, category };
}
