import { z } from "zod";

export const listMonitoringQuerySchema = z.object({
  search: z.string().trim().optional(),
  profileId: z.string().optional(),
  executiveUserId: z.string().optional(),
  categoryId: z.string().optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const listMonitoringCategoriesQuerySchema = z.object({
  includeInactive: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
  search: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  /** Active catalog for forms (large page, no admin paging UX). */
  catalog: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
});

export const effectiveChecklistQuerySchema = z.object({
  categoryId: z.string().cuid(),
});

const responseValueSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((v) => ["YES", "NO", "NA"].includes(v.toUpperCase()), {
    message: "Response must be YES, NO, or NA",
  })
  .transform((v) => v.toUpperCase());

export const checklistResponseSchema = z
  .object({
    checklistItemId: z.string().cuid().optional(),
    seChecklistItemId: z.string().cuid().optional(),
    label: z.string().trim().min(1).max(240).optional(),
    description: z.string().trim().max(1000).optional().nullable(),
    sourceType: z.enum(["TEMPLATE", "CUSTOM", "SESSION"]).optional(),
    sortOrder: z.number().int().optional(),
    value: responseValueSchema,
  })
  .superRefine((val, ctx) => {
    const hasTemplate = Boolean(val.checklistItemId);
    const hasCustom = Boolean(val.seChecklistItemId);
    const hasSession = Boolean(val.label) && val.sourceType === "SESSION";
    const kinds = [hasTemplate, hasCustom, hasSession].filter(Boolean).length;
    if (kinds !== 1 && !(hasTemplate && !hasCustom && !val.label)) {
      if (!hasTemplate && !hasCustom && !val.label) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "Each response must reference a template item, SE custom item, or session-only label",
        });
      }
    }
    if (val.sourceType === "SESSION" && !val.label) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Session-only items require a label",
      });
    }
  });

export const createMonitoringRecordSchema = z
  .object({
    salesExecutiveProfileId: z.string().cuid().optional(),
    executiveUserId: z.string().cuid().optional(),
    categoryId: z.string().cuid(),
    observation: z.string().trim().max(10000).optional().nullable(),
    observedAt: z.coerce.date().optional(),
    responses: z.array(checklistResponseSchema).min(1),
    supportInvolvement: z
      .object({
        none: z.boolean().optional(),
        salesSupportUserIds: z.array(z.string().cuid()).optional(),
      })
      .optional(),
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

export const createMonitoringCategorySchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(/^[A-Z][A-Z0-9_]*$/),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).optional().nullable(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

export const updateMonitoringCategorySchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(1000).optional().nullable(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
  archivedAt: z.coerce.date().nullable().optional(),
});

export const createChecklistItemSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(/^[A-Z][A-Z0-9_]*$/),
  label: z.string().trim().min(1).max(240),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
  defaultWeight: z.number().int().min(0).max(100).optional(),
});

export const updateChecklistItemSchema = z.object({
  label: z.string().trim().min(1).max(240).optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
  archivedAt: z.coerce.date().nullable().optional(),
  defaultWeight: z.number().int().min(0).max(100).optional(),
});

export const addSeChecklistItemSchema = z.object({
  categoryId: z.string().cuid(),
  label: z.string().trim().min(1).max(240),
  description: z.string().trim().max(1000).optional().nullable(),
  sortOrder: z.number().int().optional(),
  /** Persist for this SE (default) or only for the current session UI (no DB row). */
  scope: z.enum(["SE", "SESSION"]).default("SE"),
});

export const removeSeTemplateItemSchema = z.object({
  categoryId: z.string().cuid(),
  templateItemId: z.string().cuid(),
});

const seWeightItemSchema = z
  .object({
    checklistItemId: z.string().cuid().optional(),
    seChecklistItemId: z.string().cuid().optional(),
    weight: z.number().int().min(0).max(100),
  })
  .superRefine((val, ctx) => {
    const hasTemplate = Boolean(val.checklistItemId);
    const hasCustom = Boolean(val.seChecklistItemId);
    if (hasTemplate === hasCustom) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Each weight row must reference either a template or SE custom item",
      });
    }
  });

export const saveSeChecklistWeightsSchema = z.object({
  categoryId: z.string().cuid(),
  items: z.array(seWeightItemSchema).min(1),
});

export type ListMonitoringQuery = z.infer<typeof listMonitoringQuerySchema>;
export type ListMonitoringCategoriesQuery = z.infer<
  typeof listMonitoringCategoriesQuerySchema
>;
export type CreateMonitoringRecordInput = z.infer<
  typeof createMonitoringRecordSchema
>;
export type CreateMonitoringCategoryInput = z.infer<
  typeof createMonitoringCategorySchema
>;
export type UpdateMonitoringCategoryInput = z.infer<
  typeof updateMonitoringCategorySchema
>;
export type CreateChecklistItemInput = z.infer<typeof createChecklistItemSchema>;
export type UpdateChecklistItemInput = z.infer<typeof updateChecklistItemSchema>;
export type AddSeChecklistItemInput = z.infer<typeof addSeChecklistItemSchema>;
export type RemoveSeTemplateItemInput = z.infer<
  typeof removeSeTemplateItemSchema
>;
export type SaveSeChecklistWeightsInput = z.infer<
  typeof saveSeChecklistWeightsSchema
>;
