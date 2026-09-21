import type {
  EisenhowerCategory,
  EventImportance,
  EventUrgency,
  WorkspaceEventStatus,
  WorkspaceEventType,
} from "@prisma/client";
import { prisma } from "./prisma.js";
import { logger } from "./logger.js";

export function eisenhowerCategoryFrom(
  urgency: EventUrgency,
  importance: EventImportance,
): EisenhowerCategory {
  if (urgency === "URGENT" && importance === "IMPORTANT") return "DO_FIRST";
  if (urgency === "URGENT" && importance === "NOT_IMPORTANT") return "DELEGATE";
  if (urgency === "NOT_URGENT" && importance === "IMPORTANT") return "SCHEDULE";
  return "ELIMINATE";
}

export type RecordWorkspaceEventInput = {
  salesExecutiveProfileId: string;
  assignmentId?: string | null;
  type: WorkspaceEventType;
  title: string;
  notes?: string | null;
  nextAction?: string | null;
  urgency?: EventUrgency;
  importance?: EventImportance;
  status?: WorkspaceEventStatus;
  occurredAt?: Date;
  sourceType?: string | null;
  sourceId?: string | null;
  createdById: string;
};

/**
 * Best-effort dual-write from domain creates into the SE activity timeline.
 * Never throws to the caller — domain creates must not fail if event write fails.
 */
export async function recordWorkspaceEvent(
  input: RecordWorkspaceEventInput,
): Promise<void> {
  try {
    const urgency = input.urgency ?? "NOT_URGENT";
    const importance = input.importance ?? "IMPORTANT";
    await prisma.workspaceEvent.create({
      data: {
        salesExecutiveProfileId: input.salesExecutiveProfileId,
        assignmentId: input.assignmentId ?? null,
        type: input.type,
        title: input.title.trim().slice(0, 500),
        notes: input.notes?.trim() ? input.notes.trim().slice(0, 20000) : null,
        nextAction: input.nextAction?.trim()
          ? input.nextAction.trim().slice(0, 2000)
          : null,
        urgency,
        importance,
        status: input.status ?? "COMPLETED",
        eisenhowerCategory: eisenhowerCategoryFrom(urgency, importance),
        occurredAt: input.occurredAt ?? new Date(),
        sourceType: input.sourceType ?? null,
        sourceId: input.sourceId ?? null,
        createdById: input.createdById,
      },
    });
  } catch (err) {
    logger.error("workspace_event_dual_write_failed", {
      error: String(err),
      type: input.type,
      profileId: input.salesExecutiveProfileId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
    });
  }
}
