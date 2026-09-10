import { z } from "zod";

export const listCommandoPerformanceQuerySchema = z.object({
  search: z.string().trim().optional(),
  teamId: z.string().optional(),
  profileId: z.string().optional(),
  commandoUserId: z.string().optional(),
  status: z.enum(["ACTIVE", "COMPLETED", "EXITED"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type ListCommandoPerformanceQuery = z.infer<
  typeof listCommandoPerformanceQuerySchema
>;
