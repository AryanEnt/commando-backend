import { Router } from "express";
import {
  requireAuthentication,
  requirePermission,
} from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { PERMISSIONS } from "../../lib/permissions.js";
import { createDailyLogSchema } from "./schemas.js";
import * as controller from "./controller.js";

export const dailyLogsRouter = Router();

dailyLogsRouter.use(requireAuthentication);

dailyLogsRouter.get(
  "/",
  requirePermission(PERMISSIONS.DAILY_LOG_VIEW),
  controller.listDailyLogs,
);

dailyLogsRouter.post(
  "/",
  requirePermission(PERMISSIONS.DAILY_LOG_CREATE),
  validate(createDailyLogSchema),
  controller.createDailyLog,
);

dailyLogsRouter.get(
  "/:id",
  requirePermission(PERMISSIONS.DAILY_LOG_VIEW),
  controller.getDailyLog,
);
