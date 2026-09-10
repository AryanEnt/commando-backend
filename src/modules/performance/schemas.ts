import { z } from "zod";

const scoreSchema = z.object({
  metricCode: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[A-Z][A-Z0-9_]*$/),
  metricLabel: z.string().trim().min(1).max(120),
  scoreValue: z.coerce.number().min(0).max(100),
});

export const createPerformanceSchema = z
  .object({
    salesExecutiveProfileId: z.string().cuid(),
    summary: z.string().trim().max(10000).optional().nullable(),
    verdict: z.string().trim().max(500).optional().nullable(),
    rating: z.coerce.number().min(0).max(5).optional().nullable(),
    evaluatedAt: z.coerce.date().optional(),
    scores: z.array(scoreSchema).min(1).max(20),
  })
  .strict();

export const listPerformanceQuerySchema = z.object({
  search: z.string().trim().optional(),
  profileId: z.string().optional(),
  source: z.enum(["TEAM_LEAD", "COMMANDO"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreatePerformanceInput = z.infer<typeof createPerformanceSchema>;
export type ListPerformanceQuery = z.infer<typeof listPerformanceQuerySchema>;
