import { z } from "zod";

export const createDailyLogSchema = z.object({
  salesExecutiveProfileId: z.string().cuid(),
  activityTypeId: z.string().cuid(),
  sessionTitle: z.string().trim().min(1).max(200),
  observation: z.string().trim().min(1).max(10000),
  evidence: z.string().trim().max(10000).optional().nullable(),
  seResponse: z.string().trim().max(10000).optional().nullable(),
  coachingGiven: z.string().trim().max(10000).optional().nullable(),
  expectedChange: z.string().trim().max(10000).optional().nullable(),
  followUp: z.string().trim().max(10000).optional().nullable(),
  loggedAt: z.coerce.date().optional(),
});

export const listDailyLogsQuerySchema = z.object({
  search: z.string().trim().optional(),
  profileId: z.string().optional(),
  activityTypeId: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateDailyLogInput = z.infer<typeof createDailyLogSchema>;
export type ListDailyLogsQuery = z.infer<typeof listDailyLogsQuerySchema>;
