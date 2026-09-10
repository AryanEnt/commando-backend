import { z } from "zod";

export const acknowledgeSchema = z.object({
  entityType: z.enum(["FEEDBACK", "WEEKLY_REVIEW", "ACTION_ITEM", "INTERVENTION"]),
  entityId: z.string().min(1),
  salesExecutiveProfileId: z.string().min(1),
});

export const createGoalSchema = z.object({
  title: z.string().trim().min(1).max(240),
  ownerUserId: z.string().min(1).optional(),
  targetDate: z.coerce.date().optional().nullable(),
  progressNotes: z.string().trim().max(5000).optional().nullable(),
});
