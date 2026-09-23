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

const swotQuadrantsSchema = z.object({
  strength: nonEmptyText,
  weakness: nonEmptyText,
  opportunity: nonEmptyText,
  threat: nonEmptyText,
});

/** Team Lead approves a Commando request and provides the SE management packet. */
export const provideReferralInformationSchema = z.object({
  whySalesIsDown: nonEmptyText,
  whatIsTheGap: nonEmptyText,
  detailedSummaryOfGap: nonEmptyText,
  supportAlreadyProvided: nonEmptyText,
  supportRequiredFromCommando: nonEmptyText,
  recommendationFocus: nonEmptyText,
  priority1: z.string().trim().min(1).max(240),
  priority2: z.string().trim().min(1).max(240),
  priority3: z.string().trim().min(1).max(240),
  swot: swotQuadrantsSchema,
  /** Executive SWOT for each Sales Support currently assigned to this SE. */
  supportSwot: z
    .array(
      swotQuadrantsSchema.extend({
        executiveUserId: z.string().cuid(),
      }),
    )
    .optional()
    .default([]),
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
export type RejectReferralInput = z.infer<typeof rejectReferralSchema>;
export type ListReferralsQuery = z.infer<typeof listReferralsQuerySchema>;
