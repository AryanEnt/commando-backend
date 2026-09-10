import { z } from "zod";

export const createTeamSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional().nullable(),
});

export const updateTeamSchema = createTeamSchema.partial();

export const addMemberSchema = z.object({
  userId: z.string().cuid(),
  roleInTeam: z
    .enum([
      "TEAM_LEAD",
      "SALES_EXECUTIVE",
      "SALES_SUPPORT_EXECUTIVE",
      "MEMBER",
    ])
    .default("MEMBER"),
  startedAt: z.coerce.date().optional(),
});

export const endMemberSchema = z.object({
  endedAt: z.coerce.date().optional(),
});
