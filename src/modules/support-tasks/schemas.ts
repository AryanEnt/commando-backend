import { z } from "zod";

const text = z.string().trim().min(1).max(500);
const details = z.string().trim().max(20000).optional().nullable();

export const createSupportTaskSchema = z
  .object({
    title: text,
    description: details,
    salesExecutiveProfileId: z.string().cuid(),
    salesSupportUserId: z.string().cuid(),
    priority: z.enum(["HIGH", "MEDIUM", "LOW"]).default("MEDIUM"),
    dueDate: z.coerce.date().optional().nullable(),
  })
  .strict();

export const updateSupportTaskSchema = z
  .object({
    title: text.optional(),
    description: details,
    priority: z.enum(["HIGH", "MEDIUM", "LOW"]).optional(),
    dueDate: z.coerce.date().optional().nullable(),
    salesSupportUserId: z.string().cuid().optional(),
    status: z.enum(["PENDING", "IN_PROGRESS", "COMPLETED"]).optional(),
    completionNotes: z.string().trim().max(10000).optional().nullable(),
  })
  .strict();

export const updateSupportTaskStatusSchema = z
  .object({
    status: z.enum(["PENDING", "IN_PROGRESS", "COMPLETED"]),
    completionNotes: z.string().trim().max(10000).optional().nullable(),
  })
  .strict();

export const listSupportTasksQuerySchema = z.object({
  search: z.string().trim().optional(),
  view: z.enum(["active", "history", "all"]).default("active"),
  filter: z
    .enum(["active", "completed", "overdue", "historical", "all"])
    .optional(),
  status: z.enum(["PENDING", "IN_PROGRESS", "COMPLETED"]).optional(),
  priority: z.enum(["HIGH", "MEDIUM", "LOW"]).optional(),
  profileId: z.string().optional(),
  salesSupportUserId: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateSupportTaskInput = z.infer<typeof createSupportTaskSchema>;
export type UpdateSupportTaskInput = z.infer<typeof updateSupportTaskSchema>;
export type UpdateSupportTaskStatusInput = z.infer<
  typeof updateSupportTaskStatusSchema
>;
export type ListSupportTasksQuery = z.infer<typeof listSupportTasksQuerySchema>;
