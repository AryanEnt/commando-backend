import { Router } from "express";
import {
  requireAuthentication,
  requirePermission,
} from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { PERMISSIONS } from "../../lib/permissions.js";
import { acknowledgeSchema, createGoalSchema } from "./schemas.js";
import * as controller from "./controller.js";

export const interventionsRouter = Router();

interventionsRouter.use(requireAuthentication);

interventionsRouter.post(
  "/acknowledgements",
  requirePermission(PERMISSIONS.PROFILE_VIEW),
  validate(acknowledgeSchema),
  controller.acknowledge,
);

interventionsRouter.get(
  "/:profileId",
  requirePermission(PERMISSIONS.PROFILE_VIEW),
  controller.getIntervention,
);

interventionsRouter.get(
  "/:profileId/timeline",
  requirePermission(PERMISSIONS.PROFILE_VIEW),
  controller.getTimeline,
);

interventionsRouter.get(
  "/:profileId/goals",
  requirePermission(PERMISSIONS.PROFILE_VIEW),
  controller.listGoals,
);

interventionsRouter.post(
  "/:profileId/goals",
  requirePermission(PERMISSIONS.PROFILE_VIEW),
  validate(createGoalSchema),
  controller.createGoal,
);
