import { z } from "zod";

const nonEmptyText = z.string().trim().min(1).max(5000);

export const createReferralSchema = z.object({
  salesExecutiveProfileId: z.string().cuid(),
  commandoUserId: z.string().cuid(),
  profileName: z.string().trim().min(1).max(160),
  whySalesIsDown: nonEmptyText,
  whatIsTheGap: nonEmptyText,
  detailedSummaryOfGap: nonEmptyText,
  supportAlreadyProvided: nonEmptyText,
  supportRequiredFromCommando: nonEmptyText,
  recommendationFocus: nonEmptyText,
  priority1: z.string().trim().min(1).max(240),
  priority2: z.string().trim().min(1).max(240),
  priority3: z.string().trim().min(1).max(240),
  swot: z.object({
    strength: nonEmptyText,
    weakness: nonEmptyText,
    opportunity: nonEmptyText,
    threat: nonEmptyText,
  }),
});

/** Commando requests an SE from the Team Lead (assessment filled later by TL). */
export const createCommandoRequestSchema = z.object({
  salesExecutiveProfileId: z.string().cuid(),
  requestReason: nonEmptyText,
  note: z.string().trim().max(2000).optional().nullable(),
});

export const SE_SNAPSHOT_INSIGHTS = [
  "IMPROVING_SALES",
  "DECLINING_SALES",
  "MISSING_TARGETS",
  "STRONG_PERFORMANCE",
  "CUSTOMER_ISSUES",
  "ACTIVITY_ISSUES",
  "NEEDS_SUPPORT",
  "PERFORMANCE_CONCERN",
  "INCONSISTENT_RESULTS",
  "EXCEPTIONAL_PERFORMANCE",
] as const;

export const SSE_SNAPSHOT_INSIGHTS = [
  "STRONG_SUPPORT",
  "ACTIVITY_ISSUES",
  "NEEDS_SUPPORT",
  "INCONSISTENT_RESULTS",
  "CUSTOMER_ISSUES",
  "PERFORMANCE_CONCERN",
] as const;

const optionalAmount = z.number().finite().min(0).max(1e12).nullable().optional();

function snapshotSchema<T extends readonly [string, ...string[]]>(insights: T) {
  return z.object({
    overallPerformance: z.enum(["STRONG", "AVERAGE", "NEEDS_ATTENTION"], {
      message: "Choose an overall performance level",
    }),
    trend: z.enum(["IMPROVING", "STABLE", "DECLINING"], {
      message: "Choose a performance trend",
    }),
    insights: z
      .array(z.enum(insights))
      .min(1, "Pick at least one quick insight")
      .max(insights.length)
      .transform((list) => [...new Set(list)]),
    note: z.string().trim().min(1, "Add a short TL's note").max(2000),
    salesAchieved: optionalAmount,
    salesTarget: optionalAmount,
    achievementPct: z.number().finite().min(0).max(10000).nullable().optional(),
    monthlySales: z
      .array(
        z.object({
          month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
          salesAchieved: z.number().finite().min(0).max(1e12),
        }),
      )
      .max(12)
      .refine((sales) => new Set(sales.map((entry) => entry.month)).size === sales.length)
      .refine(
        (sales) => sales.reduce((total, entry) => total + entry.salesAchieved, 0) <= 999_999_999_999.99,
      )
      .optional(),
  });
}

export const snapshotEvidenceSchema = z.object({
  key: z.string().trim().min(1).max(500),
  fileName: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(128),
  size: z.number().int().positive(),
});

export const performanceSnapshotSchema = z.object({
  salesExecutive: snapshotSchema(SE_SNAPSHOT_INSIGHTS),
  salesSupport: z
    .array(
      snapshotSchema(SSE_SNAPSHOT_INSIGHTS).extend({
        subjectUserId: z.string().trim().min(1).max(64),
      }),
    )
    .max(10)
    .default([]),
  evidence: z.array(snapshotEvidenceSchema).max(10).default([]),
});

/** Team Lead approves a Commando request and provides the SE management packet. */
export const provideReferralInformationSchema = z.object({
  /** Required snapshot of the SE (and every linked SSE); documents optional. */
  performanceSnapshot: performanceSnapshotSchema,
  whySalesIsDown: nonEmptyText,
  whatIsTheGap: nonEmptyText,
  detailedSummaryOfGap: nonEmptyText,
  supportAlreadyProvided: nonEmptyText,
  supportRequiredFromCommando: nonEmptyText,
  recommendationFocus: nonEmptyText,
  priority1: z.string().trim().min(1).max(240),
  priority2: z.string().trim().min(1).max(240),
  priority3: z.string().trim().min(1).max(240),
});

export const listReferralsQuerySchema = z.object({
  search: z.string().trim().optional(),
  status: z
    .enum(["SUBMITTED", "ACKNOWLEDGED", "IN_PROGRESS", "COMPLETED", "REJECTED"])
    .optional(),
  initiatedBy: z.enum(["TEAM_LEAD", "COMMANDO"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const acknowledgeReferralSchema = z.object({
  note: z.string().trim().max(2000).optional().nullable(),
});

export const rejectReferralSchema = z.object({
  rejectionReason: z.string().trim().min(1).max(5000),
});

export type CreateReferralInput = z.infer<typeof createReferralSchema>;
export type CreateCommandoRequestInput = z.infer<
  typeof createCommandoRequestSchema
>;
export type ProvideReferralInformationInput = z.infer<
  typeof provideReferralInformationSchema
>;
export type PerformanceSnapshotInput = z.infer<typeof performanceSnapshotSchema>;
export type RejectReferralInput = z.infer<typeof rejectReferralSchema>;
export type ListReferralsQuery = z.infer<typeof listReferralsQuerySchema>;
