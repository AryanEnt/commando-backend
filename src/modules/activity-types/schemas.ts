import { z } from "zod";
import { paginationQuerySchema } from "../../lib/pagination.js";

const codeSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Z][A-Z0-9_]*$/, "Code must be UPPER_SNAKE_CASE");

export const createActivityTypeSchema = z.object({
  /** Optional — server generates from name when omitted. */
  code: codeSchema.optional(),
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

export const listActivityTypesQuerySchema = paginationQuerySchema.extend({
  includeInactive: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
  search: z.string().trim().optional(),
  /** When true, return active types for form selectors (pageSize defaults to 100). */
  catalog: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
});
