import { z } from "zod";

export const listMonitoringQuerySchema = z.object({
  search: z.string().trim().optional(),
  profileId: z.string().optional(),
  categoryId: z.string().optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const checklistResponseSchema = z.object({
  checklistItemId: z.string().cuid(),
  value: z.string().trim().min(1).max(64),
});

export const createMonitoringRecordSchema = z.object({
  salesExecutiveProfileId: z.string().cuid(),
  categoryId: z.string().cuid(),
  observation: z.string().trim().max(10000).optional().nullable(),
  observedAt: z.coerce.date().optional(),
  responses: z.array(checklistResponseSchema).min(1),
});

export const createMonitoringCategorySchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(/^[A-Z][A-Z0-9_]*$/),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).optional().nullable(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

export const updateMonitoringCategorySchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(1000).optional().nullable(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
  archivedAt: z.coerce.date().nullable().optional(),
});

export const createChecklistItemSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(/^[A-Z][A-Z0-9_]*$/),
  label: z.string().trim().min(1).max(240),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

export const updateChecklistItemSchema = z.object({
  label: z.string().trim().min(1).max(240).optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
  archivedAt: z.coerce.date().nullable().optional(),
});

export type ListMonitoringQuery = z.infer<typeof listMonitoringQuerySchema>;
export type CreateMonitoringRecordInput = z.infer<
  typeof createMonitoringRecordSchema
>;
export type CreateMonitoringCategoryInput = z.infer<
  typeof createMonitoringCategorySchema
>;
export type UpdateMonitoringCategoryInput = z.infer<
  typeof updateMonitoringCategorySchema
>;
export type CreateChecklistItemInput = z.infer<typeof createChecklistItemSchema>;
export type UpdateChecklistItemInput = z.infer<typeof updateChecklistItemSchema>;
