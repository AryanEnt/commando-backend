import { z } from "zod";

const text = z.string().trim().min(1).max(500);
const details = z.string().trim().max(20000).optional().nullable();
const instruction = z.string().trim().min(1).max(1000);
const instructionList = z.array(instruction).max(30).default([]);

export const SUPPORT_TASK_STATUSES = [
  "PENDING",
  "ACCEPTED",
  "IN_PROGRESS",
  "BLOCKED",
  "COMPLETED",
] as const;

export const createSupportTaskSchema = z
  .object({
    title: text,
    description: details,
    purpose: details,
    salesExecutiveProfileId: z.string().cuid(),
    salesSupportUserId: z.string().cuid(),
    priority: z.enum(["HIGH", "MEDIUM", "LOW"]).default("MEDIUM"),
    dueDate: z.coerce.date().optional().nullable(),
    shouldDo: instructionList,
    shouldNotDo: instructionList,
  })
  .strict();

export const updateSupportTaskSchema = z
  .object({
    title: text.optional(),
    description: details,
    purpose: details,
    priority: z.enum(["HIGH", "MEDIUM", "LOW"]).optional(),
    dueDate: z.coerce.date().optional().nullable(),
    salesSupportUserId: z.string().cuid().optional(),
    reassignReason: z.string().trim().max(2000).optional().nullable(),
    shouldDo: z.array(instruction).min(1).max(30).optional(),
    shouldNotDo: z.array(instruction).min(1).max(30).optional(),
  })
  .strict();

export const updateSupportTaskStatusSchema = z
  .object({
    status: z.enum(SUPPORT_TASK_STATUSES),
    completionNotes: z.string().trim().max(10000).optional().nullable(),
    blockedReason: z.string().trim().max(2000).optional().nullable(),
  })
  .strict();

export const addSupportTaskProgressNoteSchema = z
  .object({
    body: z.string().trim().min(1).max(5000),
  })
  .strict();

export const addSupportTaskAttachmentSchema = z
  .object({
    key: z.string().trim().min(1).max(512),
    fileName: z.string().trim().min(1).max(255),
    contentType: z.string().trim().min(1).max(128),
    size: z.number().int().positive().max(10 * 1024 * 1024).optional(),
    caption: z.string().trim().max(500).optional().nullable(),
  })
  .strict();

export const listSupportTasksQuerySchema = z.object({
  search: z.string().trim().optional(),
  view: z.enum(["active", "history", "all"]).default("active"),
  filter: z
    .enum(["active", "completed", "overdue", "historical", "blocked", "all"])
    .optional(),
  status: z.enum(SUPPORT_TASK_STATUSES).optional(),
  priority: z.enum(["HIGH", "MEDIUM", "LOW"]).optional(),
  profileId: z.string().optional(),
  salesSupportUserId: z.string().optional(),
  salesSupportLinkId: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateSupportTaskInput = z.infer<typeof createSupportTaskSchema>;
export type UpdateSupportTaskInput = z.infer<typeof updateSupportTaskSchema>;
export type UpdateSupportTaskStatusInput = z.infer<
  typeof updateSupportTaskStatusSchema
>;
export type AddSupportTaskProgressNoteInput = z.infer<
  typeof addSupportTaskProgressNoteSchema
>;
export type AddSupportTaskAttachmentInput = z.infer<
  typeof addSupportTaskAttachmentSchema
>;
export type ListSupportTasksQuery = z.infer<typeof listSupportTasksQuerySchema>;
