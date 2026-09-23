import { z } from "zod";

export const createFeedbackSchema = z
  .object({
    salesExecutiveProfileId: z.string().cuid().optional(),
    executiveUserId: z.string().cuid().optional(),
    body: z.string().trim().min(1).max(20000),
  })
  .strict()
  .superRefine((v, ctx) => {
    const hasProfile = Boolean(v.salesExecutiveProfileId);
    const hasExecutive = Boolean(v.executiveUserId);
    if (hasProfile === hasExecutive) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Provide exactly one of salesExecutiveProfileId or executiveUserId",
        path: hasProfile ? ["executiveUserId"] : ["salesExecutiveProfileId"],
      });
    }
  });

export const listFeedbackQuerySchema = z.object({
  search: z.string().trim().optional(),
  profileId: z.string().optional(),
  executiveUserId: z.string().optional(),
  source: z.enum(["TEAM_LEAD", "COMMANDO"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateFeedbackInput = z.infer<typeof createFeedbackSchema>;
export type ListFeedbackQuery = z.infer<typeof listFeedbackQuerySchema>;
