import { Router } from "express";
import {
  requireAuthentication,
  requirePermission,
} from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { PERMISSIONS } from "../../lib/permissions.js";
import {
  createDailyWorkLogSchema,
  updateDailyWorkLogSchema,
} from "./schemas.js";
import * as controller from "./controller.js";

export const dailyWorkLogsRouter = Router();

dailyWorkLogsRouter.use(requireAuthentication);

dailyWorkLogsRouter.get(
  "/",
  requirePermission(PERMISSIONS.DAILY_WORK_LOG_VIEW),
  controller.list,
);

dailyWorkLogsRouter.post(
  "/",
  requirePermission(PERMISSIONS.DAILY_WORK_LOG_CREATE),
  validate(createDailyWorkLogSchema),
  controller.create,
);

dailyWorkLogsRouter.get(
  "/:id",
  requirePermission(PERMISSIONS.DAILY_WORK_LOG_VIEW),
  controller.getOne,
);

dailyWorkLogsRouter.patch(
  "/:id",
  requirePermission(PERMISSIONS.DAILY_WORK_LOG_CREATE),
  validate(updateDailyWorkLogSchema),
  controller.update,
);

dailyWorkLogsRouter.delete(
  "/:id",
  requirePermission(PERMISSIONS.DAILY_WORK_LOG_CREATE),
  controller.remove,
);
