import { Router } from "express";
import {
  requireAuthentication,
  requirePermission,
} from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { PERMISSIONS } from "../../lib/permissions.js";
import {
  createDailyLogEntrySchema,
  createDailyLogSchema,
  ensureDailyLogSchema,
  submitDailyLogSchema,
  updateDailyLogEntrySchema,
} from "./schemas.js";
import * as controller from "./controller.js";

export const dailyLogsRouter = Router();

dailyLogsRouter.use(requireAuthentication);

dailyLogsRouter.get(
  "/",
  requirePermission(PERMISSIONS.DAILY_LOG_VIEW),
  controller.listDailyLogs,
);

dailyLogsRouter.get(
  "/attention",
  requirePermission(PERMISSIONS.DAILY_LOG_VIEW),
  controller.listAttentionDailyLogs,
);

dailyLogsRouter.post(
  "/ensure",
  requirePermission(PERMISSIONS.DAILY_LOG_CREATE),
  validate(ensureDailyLogSchema),
  controller.ensureDailyLog,
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

dailyLogsRouter.post(
  "/:id/entries",
  requirePermission(PERMISSIONS.DAILY_LOG_CREATE),
  validate(createDailyLogEntrySchema),
  controller.addDailyLogEntry,
);

dailyLogsRouter.patch(
  "/:id/entries/:entryId",
  requirePermission(PERMISSIONS.DAILY_LOG_CREATE),
  validate(updateDailyLogEntrySchema),
  controller.updateDailyLogEntry,
);

dailyLogsRouter.delete(
  "/:id/entries/:entryId",
  requirePermission(PERMISSIONS.DAILY_LOG_CREATE),
  controller.deleteDailyLogEntry,
);

dailyLogsRouter.post(
  "/:id/submit",
  requirePermission(PERMISSIONS.DAILY_LOG_CREATE),
  validate(submitDailyLogSchema),
  controller.submitDailyLog,
);
