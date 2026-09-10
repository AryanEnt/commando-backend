import { z } from "zod";

export const listAuditLogsQuerySchema = z.object({
  search: z.string().trim().optional(),
  actorId: z.string().optional(),
  action: z.string().trim().optional(),
  entityType: z.string().trim().optional(),
  entityId: z.string().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type ListAuditLogsQuery = z.infer<typeof listAuditLogsQuerySchema>;
