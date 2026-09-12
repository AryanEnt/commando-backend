import { z } from "zod";

export const responsibilityTypeSchema = z
  .enum([
    "GENERAL",
    "PRODUCT",
    "PRICING",
    "PROPOSAL",
    "CUSTOMER",
    "TECHNICAL",
    "PIPELINE",
    "OTHER",
  ])
  .optional()
  .nullable();

export const assignSalesSupportLinkSchema = z
  .object({
    salesExecutiveProfileId: z.string().cuid(),
    salesSupportUserId: z.string().cuid(),
    responsibilityType: responsibilityTypeSchema,
    note: z.string().trim().max(5000).optional().nullable(),
  })
  .strict();

export const endSalesSupportLinkSchema = z
  .object({
    note: z.string().trim().max(5000).optional().nullable(),
  })
  .strict();

export const listSalesSupportLinksQuerySchema = z.object({
  profileId: z.string().optional(),
  salesSupportUserId: z.string().optional(),
  isActive: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const listEligibleSupportUsersQuerySchema = z.object({
  search: z.string().trim().optional(),
  teamId: z.string().optional(),
  profileId: z.string().optional(),
});

export type AssignSalesSupportLinkInput = z.infer<
  typeof assignSalesSupportLinkSchema
>;
export type EndSalesSupportLinkInput = z.infer<typeof endSalesSupportLinkSchema>;
export type ListSalesSupportLinksQuery = z.infer<
  typeof listSalesSupportLinksQuerySchema
>;
export type ListEligibleSupportUsersQuery = z.infer<
  typeof listEligibleSupportUsersQuerySchema
>;
