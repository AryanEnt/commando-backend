import { z } from "zod";

const text = z.string().trim().min(1).max(5000);

export const createSwotSchema = z
  .object({
    salesExecutiveProfileId: z.string().cuid(),
    strength: text,
    weakness: text,
    opportunity: text,
    threat: text,
    /** TL/Commando only — share this version with the Sales Executive. */
    visibleToSalesExecutive: z.boolean().optional(),
  })
  .strict();

export const setSwotVisibilitySchema = z
  .object({
    visibleToSalesExecutive: z.boolean(),
  })
  .strict();

export const listSwotQuerySchema = z.object({
  search: z.string().trim().optional(),
  teamId: z.string().optional(),
  profileId: z.string().optional(),
  commandoUserId: z.string().optional(),
  source: z.enum(["TEAM_LEAD", "COMMANDO", "SALES_EXECUTIVE"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateSwotInput = z.infer<typeof createSwotSchema>;
export type SetSwotVisibilityInput = z.infer<typeof setSwotVisibilitySchema>;
export type ListSwotQuery = z.infer<typeof listSwotQuerySchema>;
