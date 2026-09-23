import { z } from "zod";

const entryText = z.string().trim().min(1).max(10000);
const optionalText = z.string().trim().max(10000).optional().nullable();

export const ensureDailyLogSchema = z
  .object({
    salesExecutiveProfileId: z.string().cuid().optional(),
    executiveUserId: z.string().cuid().optional(),
    /** YYYY-MM-DD; defaults to today (local calendar via server now). */
    logDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const hasProfile = Boolean(v.salesExecutiveProfileId);
    const hasExecutive = Boolean(v.executiveUserId);
    if (hasProfile === hasExecutive) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Provide exactly one of salesExecutiveProfileId or executiveUserId",
        path: hasProfile ? ["executiveUserId"] : ["salesExecutiveProfileId"],
      });
    }
  });

export const createDailyLogEntrySchema = z
  .object({
    activityTypeId: z.string().cuid(),
    sessionTitle: z.string().trim().min(1).max(200),
    observation: entryText,
    evidence: optionalText,
    seResponse: optionalText,
    coachingGiven: optionalText,
    expectedChange: optionalText,
    followUp: optionalText,
    loggedAt: z.coerce.date().optional(),
  })
  .strict();

export const updateDailyLogEntrySchema = createDailyLogEntrySchema.partial();

export const submitDailyLogSchema = z
  .object({
    classifications: z
      .array(
        z
          .object({
            entryId: z.string().cuid(),
            urgency: z.enum(["URGENT", "NOT_URGENT"]),
            importance: z.enum(["IMPORTANT", "NOT_IMPORTANT"]),
          })
          .strict(),
      )
      .max(100)
      .default([]),
  })
  .strict();

export const listDailyLogsQuerySchema = z.object({
  search: z.string().trim().optional(),
  profileId: z.string().optional(),
  executiveUserId: z.string().optional(),
  status: z.enum(["DRAFT", "SUBMITTED"]).optional(),
  dateFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  dateTo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

/** @deprecated — prefer ensure + add entry. Kept for transitional clients. */
export const createDailyLogSchema = z
  .object({
    salesExecutiveProfileId: z.string().cuid().optional(),
    executiveUserId: z.string().cuid().optional(),
    activityTypeId: z.string().cuid(),
    sessionTitle: z.string().trim().min(1).max(200),
    observation: z.string().trim().min(1).max(10000),
    evidence: z.string().trim().max(10000).optional().nullable(),
    seResponse: z.string().trim().max(10000).optional().nullable(),
    coachingGiven: z.string().trim().max(10000).optional().nullable(),
    expectedChange: z.string().trim().max(10000).optional().nullable(),
    followUp: z.string().trim().max(10000).optional().nullable(),
    loggedAt: z.coerce.date().optional(),
  })
  .superRefine((v, ctx) => {
    const hasProfile = Boolean(v.salesExecutiveProfileId);
    const hasExecutive = Boolean(v.executiveUserId);
    if (hasProfile === hasExecutive) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Provide exactly one of salesExecutiveProfileId or executiveUserId",
      });
    }
  });

export type EnsureDailyLogInput = z.infer<typeof ensureDailyLogSchema>;
export type CreateDailyLogEntryInput = z.infer<typeof createDailyLogEntrySchema>;
export type UpdateDailyLogEntryInput = z.infer<typeof updateDailyLogEntrySchema>;
export type SubmitDailyLogInput = z.infer<typeof submitDailyLogSchema>;
export type ListDailyLogsQuery = z.infer<typeof listDailyLogsQuerySchema>;
export type CreateDailyLogInput = z.infer<typeof createDailyLogSchema>;
