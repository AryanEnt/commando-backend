import { z } from "zod";

export const workspaceEventTypes = [
  "MONITORING",
  "COACHING",
  "FEEDBACK",
  "DAILY_LOG",
  "REVIEW",
  "ACTION",
  "SUPPORT",
  "INTERVENTION",
  "SWOT",
  "GENERAL",
] as const;

export const createWorkspaceEventSchema = z
  .object({
    salesExecutiveProfileId: z.string().cuid(),
    type: z.enum(workspaceEventTypes),
    title: z.string().trim().min(1).max(500),
    notes: z.string().trim().max(20000).optional().nullable(),
    nextAction: z.string().trim().max(2000).optional().nullable(),
    urgency: z.enum(["URGENT", "NOT_URGENT"]).default("NOT_URGENT"),
    importance: z.enum(["IMPORTANT", "NOT_IMPORTANT"]).default("IMPORTANT"),
    status: z
      .enum(["OPEN", "IN_PROGRESS", "COMPLETED", "CANCELLED"])
      .default("COMPLETED"),
    occurredAt: z.coerce.date().optional(),
    /** When true and type=ACTION, also creates an ActionItem. Default true for ACTION. */
    createLinkedRecord: z.boolean().optional(),
  })
  .strict();

export const listWorkspaceEventsQuerySchema = z.object({
  profileId: z.string().cuid(),
  type: z.enum(workspaceEventTypes).optional(),
  search: z.string().trim().max(200).optional(),
  range: z.enum(["today", "week", "month", "all"]).default("all"),
  eisenhowerCategory: z
    .enum(["DO_FIRST", "SCHEDULE", "DELEGATE", "ELIMINATE"])
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

export type CreateWorkspaceEventInput = z.infer<
  typeof createWorkspaceEventSchema
>;
export type ListWorkspaceEventsQuery = z.infer<
  typeof listWorkspaceEventsQuerySchema
>;
