import { z } from "zod";

export const createAssignmentSchema = z.object({
  salesExecutiveProfileId: z.string().cuid(),
  commandoUserId: z.string().cuid(),
  teamLeadUserId: z.string().cuid(),
  teamId: z.string().min(1),
  startedAt: z.coerce.date().optional(),
});

export const HANDOFF_DESCRIPTION_MIN = 20;

const optionalAmount = z.number().finite().min(0).max(1e12).nullable().optional();

export const handoffAttachmentSchema = z.object({
  key: z.string().trim().min(1).max(500),
  fileName: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(128),
  size: z.number().int().positive(),
});

export const handoffReportSchema = z.object({
  subjectUserId: z.string().trim().min(1).max(64),
  description: z
    .string()
    .trim()
    .min(
      HANDOFF_DESCRIPTION_MIN,
      `Describe performance in at least ${HANDOFF_DESCRIPTION_MIN} characters`,
    )
    .max(5000),
  salesAchieved: optionalAmount,
  salesTarget: optionalAmount,
  attachments: z.array(handoffAttachmentSchema).max(5).default([]),
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
  /** One report per person (SE + each linked SSE); checked against links in the service. */
  handoffReports: z.array(handoffReportSchema).max(11).default([]),
});

export const transferAssignmentSchema = z.object({
  newCommandoUserId: z.string().cuid(),
  teamLeadUserId: z.string().cuid().optional(),
  reason: z.string().trim().min(1).max(2000),
  effectiveAt: z.coerce.date().optional(),
});

export const subjectHandoffReportsQuerySchema = z.object({
  subjectUserId: z.string().trim().min(1).max(64),
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
