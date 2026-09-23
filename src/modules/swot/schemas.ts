import { z } from "zod";

const text = z.string().trim().min(1).max(5000);

const swotPointInput = z.object({
  id: z.string().trim().min(1).max(80).optional(),
  text: z.string().trim().min(1).max(2000),
  visible: z.boolean().optional(),
});

const pointsList = z.array(swotPointInput).min(1).max(40);

export const createSwotSchema = z
  .object({
    /**
     * What the SWOT is about.
     * EXECUTIVE = person; PROFILE = sales profile/workspace.
     * Defaults: self SWOT → EXECUTIVE; packet creates PROFILE explicitly.
     */
    subjectType: z.enum(["EXECUTIVE", "PROFILE"]).optional(),
    /** PROFILE subject — sales profile id */
    salesExecutiveProfileId: z.string().trim().min(1).max(64).optional(),
    /** EXECUTIVE subject — person User.id */
    executiveUserId: z.string().trim().min(1).max(64).optional(),
    /** @deprecated Alias for executiveUserId (SSE / older clients) */
    subjectUserId: z.string().trim().min(1).max(64).optional(),
    strength: text.optional(),
    weakness: text.optional(),
    opportunity: text.optional(),
    threat: text.optional(),
    strengthPoints: pointsList.optional(),
    weaknessPoints: pointsList.optional(),
    opportunityPoints: pointsList.optional(),
    threatPoints: pointsList.optional(),
    /** TL/Commando only — share every point with the subject executive. */
    visibleToSalesExecutive: z.boolean().optional(),
    visibleStrength: z.boolean().optional(),
    visibleWeakness: z.boolean().optional(),
    visibleOpportunity: z.boolean().optional(),
    visibleThreat: z.boolean().optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const executiveId = v.executiveUserId ?? v.subjectUserId;
    if (v.executiveUserId && v.subjectUserId && v.executiveUserId !== v.subjectUserId) {
      ctx.addIssue({
        code: "custom",
        message: "executiveUserId and subjectUserId must match when both provided",
        path: ["subjectUserId"],
      });
    }

    const subjectType = v.subjectType;
    if (subjectType === "PROFILE") {
      ctx.addIssue({
        code: "custom",
        message:
          "Profile SWOT is no longer used. Create an Executive SWOT for the Sales Executive instead.",
        path: ["subjectType"],
      });
    } else if (subjectType === "EXECUTIVE") {
      // May resolve person from salesExecutiveProfileId for SE executives
      if (!executiveId && !v.salesExecutiveProfileId) {
        ctx.addIssue({
          code: "custom",
          message:
            "Provide executiveUserId (or salesExecutiveProfileId to resolve the person) for Executive SWOT",
          path: ["executiveUserId"],
        });
      }
    } else {
      // Unspecified: XOR between profile and executive ids (legacy clients)
      const hasProfile = Boolean(v.salesExecutiveProfileId);
      const hasExecutive = Boolean(executiveId);
      if (hasProfile && hasExecutive) {
        ctx.addIssue({
          code: "custom",
          message:
            "Provide either salesExecutiveProfileId or executiveUserId, not both (or set subjectType)",
          path: ["executiveUserId"],
        });
      }
    }

    const quadrants = [
      ["strength", v.strength, v.strengthPoints],
      ["weakness", v.weakness, v.weaknessPoints],
      ["opportunity", v.opportunity, v.opportunityPoints],
      ["threat", v.threat, v.threatPoints],
    ] as const;
    for (const [key, blob, points] of quadrants) {
      if (!blob?.trim() && (!points || points.length === 0)) {
        ctx.addIssue({
          code: "custom",
          message: `Add at least one ${key} point`,
          path: [key],
        });
      }
    }
  });

export const setSwotVisibilitySchema = z
  .object({
    visibleToSalesExecutive: z.boolean().optional(),
    visibleStrength: z.boolean().optional(),
    visibleWeakness: z.boolean().optional(),
    visibleOpportunity: z.boolean().optional(),
    visibleThreat: z.boolean().optional(),
    point: z
      .object({
        quadrant: z.enum(["strength", "weakness", "opportunity", "threat"]),
        id: z.string().min(1),
        visible: z.boolean(),
      })
      .optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.visibleToSalesExecutive !== undefined ||
      v.visibleStrength !== undefined ||
      v.visibleWeakness !== undefined ||
      v.visibleOpportunity !== undefined ||
      v.visibleThreat !== undefined ||
      v.point !== undefined,
    { message: "Provide at least one visibility field" },
  );

export const listSwotQuerySchema = z.object({
  search: z.string().trim().optional(),
  teamId: z.string().optional(),
  profileId: z.string().optional(),
  executiveUserId: z.string().optional(),
  /** @deprecated Alias for executiveUserId */
  subjectUserId: z.string().optional(),
  subjectType: z.enum(["EXECUTIVE", "PROFILE"]).optional(),
  commandoUserId: z.string().optional(),
  source: z
    .enum([
      "TEAM_LEAD",
      "COMMANDO",
      "SALES_EXECUTIVE",
      "SALES_SUPPORT_EXECUTIVE",
    ])
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateSwotInput = z.infer<typeof createSwotSchema>;
export type SetSwotVisibilityInput = z.infer<typeof setSwotVisibilitySchema>;
export type ListSwotQuery = z.infer<typeof listSwotQuerySchema>;
