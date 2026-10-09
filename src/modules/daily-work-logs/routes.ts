import { Router } from "express";
import {
  requireAuthentication,
  requirePermission,
} from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { PERMISSIONS } from "../../lib/permissions.js";
import {
  createCommitmentPlanSchema,
  createDailyWorkLogSchema,
  saveDailyWorkCommitmentSchema,
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
  "/activity-options",
  requirePermission(PERMISSIONS.DAILY_WORK_LOG_VIEW),
  controller.activityOptions,
);

dailyWorkLogsRouter.get(
  "/commitments",
  requirePermission(PERMISSIONS.DAILY_WORK_LOG_VIEW),
  controller.listCommitments,
);

dailyWorkLogsRouter.post(
  "/commitments/plan",
  requirePermission(PERMISSIONS.DAILY_WORK_LOG_CREATE),
  validate(createCommitmentPlanSchema),
  controller.createCommitmentPlan,
);

dailyWorkLogsRouter.put(
  "/commitments/today",
  requirePermission(PERMISSIONS.DAILY_WORK_LOG_CREATE),
  validate(saveDailyWorkCommitmentSchema),
  controller.saveCommitment,
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

