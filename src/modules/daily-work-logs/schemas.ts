import { z } from "zod";

export const listDailyWorkLogsQuerySchema = z.object({
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

export const createDailyWorkLogSchema = z.object({
  activity: z.string().trim().min(1).max(500),
  notes: z.string().trim().max(5000).optional().nullable(),
  loggedAt: z.coerce.date(),
});

export const updateDailyWorkLogSchema = z.object({
  activity: z.string().trim().min(1).max(500).optional(),
  notes: z.string().trim().max(5000).optional().nullable(),
  loggedAt: z.coerce.date().optional(),
});

export type ListDailyWorkLogsQuery = z.infer<typeof listDailyWorkLogsQuerySchema>;
export type CreateDailyWorkLogInput = z.infer<typeof createDailyWorkLogSchema>;
export type UpdateDailyWorkLogInput = z.infer<typeof updateDailyWorkLogSchema>;
