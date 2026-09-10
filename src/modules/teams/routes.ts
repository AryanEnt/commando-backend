import { Router } from "express";
import {
  requireAuthentication,
  requirePermission,
} from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { PERMISSIONS } from "../../lib/permissions.js";
import {
  addMemberSchema,
  createTeamSchema,
  endMemberSchema,
  updateTeamSchema,
} from "./schemas.js";
import * as controller from "./controller.js";

export const teamsRouter = Router();

teamsRouter.use(requireAuthentication);

teamsRouter.get(
  "/",
  requirePermission(PERMISSIONS.TEAM_VIEW),
  controller.listTeams,
);

teamsRouter.post(
  "/",
  requirePermission(PERMISSIONS.TEAM_MANAGE),
  validate(createTeamSchema),
  controller.createTeam,
);

teamsRouter.get(
  "/:id",
  requirePermission(PERMISSIONS.TEAM_VIEW),
  controller.getTeam,
);

teamsRouter.patch(
  "/:id",
  requirePermission(PERMISSIONS.TEAM_MANAGE),
  validate(updateTeamSchema),
  controller.updateTeam,
);

teamsRouter.get(
  "/:id/members",
  requirePermission(PERMISSIONS.TEAM_VIEW),
  controller.listMembers,
);

teamsRouter.post(
  "/:id/members",
  requirePermission(PERMISSIONS.TEAM_MANAGE),
  validate(addMemberSchema),
  controller.addMember,
);

teamsRouter.post(
  "/:id/members/:membershipId/end",
  requirePermission(PERMISSIONS.TEAM_MANAGE),
  validate(endMemberSchema),
  controller.endMember,
);
