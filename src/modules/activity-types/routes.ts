import { Router } from "express";
import {
  requireAuthentication,
  requirePermission,
  requireAnyPermission,
} from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { PERMISSIONS } from "../../lib/permissions.js";
import {
  createActivityTypeSchema,
  updateActivityTypeSchema,
} from "./schemas.js";
import * as controller from "./controller.js";

export const activityTypesRouter = Router();

activityTypesRouter.use(requireAuthentication);

activityTypesRouter.get(
  "/",
  requireAnyPermission([
    PERMISSIONS.DAILY_LOG_VIEW,
    PERMISSIONS.DAILY_LOG_CREATE,
    PERMISSIONS.ACTIVITY_TYPE_MANAGE,
  ]),
  controller.listActivityTypes,
);

activityTypesRouter.post(
  "/",
  requirePermission(PERMISSIONS.ACTIVITY_TYPE_MANAGE),
  validate(createActivityTypeSchema),
  controller.createActivityType,
);

activityTypesRouter.patch(
  "/:id",
  requirePermission(PERMISSIONS.ACTIVITY_TYPE_MANAGE),
  validate(updateActivityTypeSchema),
  controller.updateActivityType,
);
