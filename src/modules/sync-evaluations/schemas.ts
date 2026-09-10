import { z } from "zod";

const text = z.string().trim().min(1).max(10000);

export const createSyncEvaluationSchema = z.object({
  salesExecutiveProfileId: z.string().cuid(),
  salesSupportUserId: z.string().cuid(),
  issue: text,
  recommendedAction: text,
});

export const listSyncEvaluationsQuerySchema = z.object({
  search: z.string().trim().optional(),
  profileId: z.string().optional(),
  salesSupportUserId: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const supportLinksQuerySchema = z.object({
  profileId: z.string().cuid(),
});

export type CreateSyncEvaluationInput = z.infer<
  typeof createSyncEvaluationSchema
>;
export type ListSyncEvaluationsQuery = z.infer<
  typeof listSyncEvaluationsQuerySchema
>;
