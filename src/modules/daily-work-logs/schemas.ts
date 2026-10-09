import { z } from "zod";

export const dailyWorkEntryKind = z.enum(["LOG", "COMMITMENT"]);

export const listDailyWorkLogsQuerySchema = z.object({
  /** LOG (default) = completed work; COMMITMENT = planned rows. */
  kind: dailyWorkEntryKind.default("LOG"),
  authorUserId: z.string().cuid().optional(),
  profileId: z.string().cuid().optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  /** Calendar day filter (YYYY-MM-DD); overrides dateFrom/dateTo when set. */
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  search: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

/**
 * Author's `Date#getTimezoneOffset()` (minutes behind UTC). Used to resolve the
 * author's local calendar day for the start-of-day commitment rule.
 */
const tzOffsetMinutes = z.coerce.number().int().min(-840).max(840).default(0);

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const MAX_DAILY_WORK_LOG_ATTACHMENTS = 5;

export const dailyWorkLogAttachmentSchema = z
  .object({
    key: z.string().trim().min(1).max(512),
    fileName: z.string().trim().min(1).max(255),
    contentType: z.string().trim().min(1).max(128),
    size: z.number().int().positive().max(10 * 1024 * 1024).optional(),
  })
  .strict();

/** New screenshots to attach (already uploaded to R2). */
const attachments = z
  .array(dailyWorkLogAttachmentSchema)
  .max(MAX_DAILY_WORK_LOG_ATTACHMENTS)
  .optional();

export const MAX_TASK_DURATION_MINUTES = 24 * 60;

/** Task start / end — both set, both null (clear), or both omitted. */
const taskTime = {
  startedAt: z.coerce.date().optional().nullable(),
  endedAt: z.coerce.date().optional().nullable(),
};

function refineTaskTime(
  data: { startedAt?: Date | null; endedAt?: Date | null },
  ctx: z.RefinementCtx,
) {
  const { startedAt, endedAt } = data;
  if (startedAt === undefined && endedAt === undefined) return;
  if (startedAt === null && endedAt === null) return;
  if (!startedAt || !endedAt) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [startedAt ? "endedAt" : "startedAt"],
      message: "Enter both a start time and an end time",
    });
    return;
  }
  const minutes = (endedAt.getTime() - startedAt.getTime()) / 60_000;
  if (minutes < 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["endedAt"],
      message: "End time must be after start time",
    });
  } else if (minutes > MAX_TASK_DURATION_MINUTES) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["endedAt"],
      message: "A task can't be longer than 24 hours",
    });
  }
}

export const MAX_WORK_COUNT = 100_000;
export const MAX_TOTAL_AMOUNT = 999_999_999_999;

/** Structured activity fields; codes are checked against the role config in the service. */
const structured = {
  listItem: z.string().trim().min(1).max(64).optional(),
  subItem: z.string().trim().min(1).max(64).optional().nullable(),
  count: z.number().int().min(1).max(MAX_WORK_COUNT).optional(),
  /** Older free-text duration ("2min - 5min"); new entries send startedAt / endedAt. */
  timeRange: z.string().trim().min(1).max(40).optional().nullable(),
  totalAmount: z
    .number()
    .min(0)
    .max(MAX_TOTAL_AMOUNT)
    .optional()
    .nullable(),
};

export const createDailyWorkLogSchema = z
  .object({
    kind: dailyWorkEntryKind.default("LOG"),
    /** Free-text activity (older entries); structured entries send listItem instead. */
    activity: z.string().trim().min(1).max(500).optional(),
    ...structured,
    notes: z.string().trim().max(5000).optional().nullable(),
    loggedAt: z.coerce.date(),
    ...taskTime,
    attachments,
    tzOffsetMinutes,
  })
  .superRefine((data, ctx) => {
    refineTaskTime(data, ctx);
    if (data.kind === "COMMITMENT") {
      if (!data.notes?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["notes"],
          message: "Describe what you plan to do",
        });
      }
      return;
    }
    if (data.listItem) {
      if (data.count === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["count"], message: "Enter a count" });
      }
      if (!data.timeRange && !(data.startedAt && data.endedAt)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["startedAt"],
          message: "Enter a start time and an end time",
        });
      }
    } else if (!data.activity) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["activity"], message: "Activity is required" });
    }
  });

export const updateDailyWorkLogSchema = z
  .object({
    activity: z.string().trim().min(1).max(500).optional(),
    ...structured,
    notes: z.string().trim().max(5000).optional().nullable(),
    loggedAt: z.coerce.date().optional(),
    ...taskTime,
    attachments,
    removeAttachmentIds: z
      .array(z.string().cuid())
      .max(MAX_DAILY_WORK_LOG_ATTACHMENTS)
      .optional(),
    tzOffsetMinutes,
  })
  .superRefine(refineTaskTime);

export const MAX_COMMITMENT_ITEMS = 30;

const commitmentItemSchema = z
  .object({
    listItem: z.string().trim().min(1).max(64),
    subItem: z.string().trim().min(1).max(64).optional().nullable(),
    count: z.number().int().min(1).max(MAX_WORK_COUNT),
    totalAmount: z.number().min(0).max(MAX_TOTAL_AMOUNT).optional().nullable(),
  })
  .strict();

/** Today's commitment as planned activities (no time range), saved in one go. */
export const createCommitmentPlanSchema = z.object({
  items: z
    .array(commitmentItemSchema)
    .min(1, "Pick at least one activity you plan to work on")
    .max(MAX_COMMITMENT_ITEMS),
  note: z.string().trim().max(2000).optional().nullable(),
  tzOffsetMinutes,
});

export const listDailyWorkCommitmentsQuerySchema = z
  .object({
    authorUserId: z.string().cuid().optional(),
    profileId: z.string().cuid().optional(),
    dateFrom: dateOnly,
    dateTo: dateOnly,
  })
  .refine((q) => q.dateFrom <= q.dateTo, {
    message: "dateFrom must be on or before dateTo",
    path: ["dateFrom"],
  });

export const saveDailyWorkCommitmentSchema = z.object({
  commitment: z.string().trim().min(1).max(2000),
  tzOffsetMinutes,
});

export type ListDailyWorkLogsQuery = z.infer<typeof listDailyWorkLogsQuerySchema>;
export type CreateDailyWorkLogInput = z.infer<typeof createDailyWorkLogSchema>;
export type UpdateDailyWorkLogInput = z.infer<typeof updateDailyWorkLogSchema>;
export type DailyWorkLogAttachmentInput = z.infer<
  typeof dailyWorkLogAttachmentSchema
>;
export type CreateCommitmentPlanInput = z.infer<typeof createCommitmentPlanSchema>;
export type ListDailyWorkCommitmentsQuery = z.infer<
  typeof listDailyWorkCommitmentsQuerySchema
>;
export type SaveDailyWorkCommitmentInput = z.infer<
  typeof saveDailyWorkCommitmentSchema
>;
