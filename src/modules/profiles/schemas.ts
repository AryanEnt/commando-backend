import { z } from "zod";

export const createProfileSchema = z.object({
  userId: z.string().cuid(),
  teamId: z.string().min(1),
  displayName: z.string().trim().min(1).max(160),
  employeeCode: z.string().trim().max(64).optional().nullable(),
});

export const updateProfileSchema = z.object({
  teamId: z.string().min(1).optional(),
  displayName: z.string().trim().min(1).max(160).optional(),
  employeeCode: z.string().trim().max(64).optional().nullable(),
  archivedAt: z.coerce.date().nullable().optional(),
});

export const listProfilesQuerySchema = z.object({
  search: z.string().trim().optional(),
  teamId: z.string().optional(),
  /** Commando: include completed/exited assignments (read-only history). */
  includeHistory: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
