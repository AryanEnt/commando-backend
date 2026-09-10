import { z } from "zod";

const textItem = z.string().trim().min(1).max(1000);

export const createRoleAssignmentSchema = z.object({
  salesExecutiveProfileId: z.string().cuid(),
  salesSupportUserId: z.string().cuid(),
  primaryResponsibility: z.string().trim().min(1).max(2000),
  shouldDo: z.array(textItem).min(1).max(50),
  shouldNotDo: z.array(textItem).min(1).max(50),
});

export const updateRoleAssignmentSchema = z.object({
  primaryResponsibility: z.string().trim().min(1).max(2000).optional(),
  shouldDo: z.array(textItem).min(1).max(50).optional(),
  shouldNotDo: z.array(textItem).min(1).max(50).optional(),
});

export const listRoleAssignmentsQuerySchema = z.object({
  search: z.string().trim().optional(),
  profileId: z.string().optional(),
  salesSupportUserId: z.string().optional(),
  status: z.enum(["ACTIVE", "SUPERSEDED", "ARCHIVED"]).optional(),
  includeHistory: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateRoleAssignmentInput = z.infer<
  typeof createRoleAssignmentSchema
>;
export type UpdateRoleAssignmentInput = z.infer<
  typeof updateRoleAssignmentSchema
>;
export type ListRoleAssignmentsQuery = z.infer<
  typeof listRoleAssignmentsQuerySchema
>;
