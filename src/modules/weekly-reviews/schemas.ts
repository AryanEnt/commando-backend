import { z } from "zod";

const text = z.string().trim().min(1).max(10000);

export const createWeeklyReviewSchema = z.object({
  salesExecutiveProfileId: z.string().cuid(),
  weekLabel: z.string().trim().min(1).max(64),
  weekStartDate: z.coerce.date(),
  meetingDate: z.coerce.date(),
  performanceSummary: text,
  whatWentWell: text,
  improvement: text,
  nextWeekAction: text,
  attendeeUserIds: z.array(z.string().cuid()).optional(),
});

export const updateWeeklyReviewSchema = z.object({
  weekLabel: z.string().trim().min(1).max(64).optional(),
  weekStartDate: z.coerce.date().optional(),
  meetingDate: z.coerce.date().optional(),
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

export type CreateWeeklyReviewInput = z.infer<typeof createWeeklyReviewSchema>;
export type UpdateWeeklyReviewInput = z.infer<typeof updateWeeklyReviewSchema>;
export type ListWeeklyReviewsQuery = z.infer<typeof listWeeklyReviewsQuerySchema>;
