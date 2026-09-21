import { z } from "zod";

const text = z.string().trim().min(1).max(10000);
const actionLine = z.string().trim().min(1).max(500);
const roomName = z.string().trim().min(1).max(120);
const meetingTime = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:mm (24-hour)");

const minutesMeta = z
  .object({
    key: z.string().trim().min(1).max(512),
    fileName: z.string().trim().min(1).max(255),
    contentType: z.string().trim().min(1).max(128),
    size: z.number().int().positive().max(10 * 1024 * 1024).optional(),
  })
  .strict();

export const createWeeklyReviewSchema = z
  .object({
    salesExecutiveProfileId: z.string().cuid(),
    weekLabel: z.string().trim().min(1).max(64),
    weekStartDate: z.coerce.date(),
    meetingDate: z.coerce.date(),
    roomName,
    meetingTime,
    meetingMinutes: minutesMeta.optional().nullable(),
    performanceSummary: text,
    whatWentWell: text,
    improvement: text,
    /** Legacy single-string field — still accepted. */
    nextWeekAction: z.string().trim().max(10000).optional(),
    /** Preferred: one Action Item per entry. */
    nextWeekActions: z.array(actionLine).max(20).optional(),
    /** Carry-forward updates for previous review actions. */
    followUpActions: z
      .array(
        z.object({
          actionItemId: z.string().cuid(),
          status: z.enum(["COMPLETED", "ACTIVE", "CANCELLED"]),
        }),
      )
      .max(50)
      .optional(),
    attendeeUserIds: z.array(z.string().cuid()).optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    const fromList = (val.nextWeekActions ?? [])
      .map((s) => s.trim())
      .filter(Boolean);
    const fromLegacy = val.nextWeekAction?.trim() ?? "";
    if (fromList.length === 0 && !fromLegacy) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Add at least one next-week action",
        path: ["nextWeekActions"],
      });
    }
  });

export const updateWeeklyReviewSchema = z.object({
  weekLabel: z.string().trim().min(1).max(64).optional(),
  weekStartDate: z.coerce.date().optional(),
  meetingDate: z.coerce.date().optional(),
  roomName: roomName.optional(),
  meetingTime: meetingTime.optional(),
  meetingMinutes: minutesMeta.optional().nullable(),
  performanceSummary: text.optional(),
  whatWentWell: text.optional(),
  improvement: text.optional(),
  nextWeekAction: text.optional(),
  attendeeUserIds: z.array(z.string().cuid()).optional(),
});

export const listWeeklyReviewsQuerySchema = z.object({
  search: z.string().trim().optional(),
  status: z.enum(["DRAFT", "SUBMITTED"]).optional(),
  profileId: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

/** Coaching hub: one SE + one calendar week (Monday–Sunday). */
export const weeklyReviewHubQuerySchema = z.object({
  profileId: z.string().cuid(),
  /** Any date in the week as YYYY-MM-DD; normalized to that week's Monday. */
  weekStart: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export type CreateWeeklyReviewInput = z.infer<typeof createWeeklyReviewSchema>;
export type UpdateWeeklyReviewInput = z.infer<typeof updateWeeklyReviewSchema>;
export type ListWeeklyReviewsQuery = z.infer<typeof listWeeklyReviewsQuerySchema>;
export type WeeklyReviewHubQuery = z.infer<typeof weeklyReviewHubQuerySchema>;