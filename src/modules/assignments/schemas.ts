import { z } from "zod";

export const createAssignmentSchema = z.object({
  salesExecutiveProfileId: z.string().cuid(),
  commandoUserId: z.string().cuid(),
  teamLeadUserId: z.string().cuid(),
  teamId: z.string().min(1),
  startedAt: z.coerce.date().optional(),
});

export const endAssignmentSchema = z.object({
  status: z.enum(["COMPLETED", "EXITED"]),
  endedAt: z.coerce.date().optional(),
  completionReason: z.string().trim().max(2000).optional().nullable(),
  outcome: z
    .enum([
      "IMPROVED",
      "PARTIALLY_IMPROVED",
      "NOT_IMPROVED",
      "CONTINUED_MONITORING",
      "OTHER",
    ])
    .optional()
    .nullable(),
  initialProblem: z.string().trim().max(5000).optional().nullable(),
  interventionProvided: z.string().trim().max(5000).optional().nullable(),
  improvementObserved: z.string().trim().max(5000).optional().nullable(),
  remainingGaps: z.string().trim().max(5000).optional().nullable(),
  finalCommandoAssessment: z.string().trim().max(5000).optional().nullable(),
  finalTeamLeadView: z.string().trim().max(5000).optional().nullable(),
});

export const transferAssignmentSchema = z.object({
  newCommandoUserId: z.string().cuid(),
  teamLeadUserId: z.string().cuid().optional(),
  reason: z.string().trim().min(1).max(2000),
  effectiveAt: z.coerce.date().optional(),
});

export const listAssignmentsQuerySchema = z.object({
  profileId: z.string().optional(),
  status: z.enum(["ACTIVE", "COMPLETED", "EXITED"]).optional(),
  currentOnly: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
