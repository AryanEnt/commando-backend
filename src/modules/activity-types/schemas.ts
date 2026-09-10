import { z } from "zod";

export const createActivityTypeSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[A-Z][A-Z0-9_]*$/, "Code must be UPPER_SNAKE_CASE"),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional().nullable(),
  isActive: z.boolean().optional().default(true),
});

export const updateActivityTypeSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(2000).optional().nullable(),
  isActive: z.boolean().optional(),
  archivedAt: z.coerce.date().nullable().optional(),
});

export const listActivityTypesQuerySchema = z.object({
  includeInactive: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
});
