import { z } from "zod";

export const eisenhowerCategorySchema = z.enum([
  "DO_FIRST",
  "SCHEDULE",
  "DELEGATE",
  "ELIMINATE",
]);

export const eisenhowerStatusSchema = z.enum([
  "OPEN",
  "IN_PROGRESS",
  "DONE",
  "CANCELLED",
]);

/** Accept YYYY-MM or a date; normalize to first day of month. */
export const monthInputSchema = z
  .union([z.string().regex(/^\d{4}-\d{2}$/), z.coerce.date()])
  .transform((value) => {
    if (typeof value === "string") {
      const [y, m] = value.split("-").map(Number);
      return new Date(Date.UTC(y, m - 1, 1));
    }
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
  });

export const createEisenhowerTaskSchema = z.object({
  salesExecutiveProfileId: z.string().cuid(),
  month: monthInputSchema,
  category: eisenhowerCategorySchema,
  title: z.string().trim().min(1).max(240),
  notes: z.string().trim().max(10000).optional().nullable(),
  dueDate: z.coerce.date().optional().nullable(),
  status: eisenhowerStatusSchema.optional(),
});

export const updateEisenhowerTaskSchema = z.object({
  category: eisenhowerCategorySchema.optional(),
  title: z.string().trim().min(1).max(240).optional(),
  notes: z.string().trim().max(10000).optional().nullable(),
  dueDate: z.coerce.date().optional().nullable(),
  month: monthInputSchema.optional(),
});

export const updateEisenhowerStatusSchema = z.object({
  status: eisenhowerStatusSchema,
});

export const listEisenhowerQuerySchema = z.object({
  search: z.string().trim().optional(),
  profileId: z.string().optional(),
  month: monthInputSchema.optional(),
  category: eisenhowerCategorySchema.optional(),
  status: eisenhowerStatusSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

export type CreateEisenhowerTaskInput = z.infer<
  typeof createEisenhowerTaskSchema
>;
export type UpdateEisenhowerTaskInput = z.infer<
  typeof updateEisenhowerTaskSchema
>;
export type UpdateEisenhowerStatusInput = z.infer<
  typeof updateEisenhowerStatusSchema
>;
export type ListEisenhowerQuery = z.infer<typeof listEisenhowerQuerySchema>;
