import { z } from "zod";

export const createActionItemSchema = z.object({
  salesExecutiveProfileId: z.string().cuid(),
  title: z.string().trim().min(1).max(240),
  description: z.string().trim().max(10000).optional().nullable(),
  dueDate: z.coerce.date().optional().nullable(),
});

export const updateActionItemSchema = z.object({
  title: z.string().trim().min(1).max(240).optional(),
  description: z.string().trim().max(10000).optional().nullable(),
  dueDate: z.coerce.date().optional().nullable(),
});

export const replaceActionItemSchema = z.object({
  title: z.string().trim().min(1).max(240),
  description: z.string().trim().max(10000).optional().nullable(),
  dueDate: z.coerce.date().optional().nullable(),
});

export const listActionItemsQuerySchema = z.object({
  search: z.string().trim().optional(),
  profileId: z.string().optional(),
  status: z
    .enum(["ACTIVE", "COMPLETED", "EXPIRED", "REPLACED", "CANCELLED"])
    .optional(),
  /** active = ACTIVE only; history = completed/expired/replaced/cancelled */
  view: z.enum(["active", "history", "all"]).default("active"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateActionItemInput = z.infer<typeof createActionItemSchema>;
export type UpdateActionItemInput = z.infer<typeof updateActionItemSchema>;
export type ReplaceActionItemInput = z.infer<typeof replaceActionItemSchema>;
export type ListActionItemsQuery = z.infer<typeof listActionItemsQuerySchema>;
