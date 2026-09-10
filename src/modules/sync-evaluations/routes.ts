import { Router } from "express";
import {
  requireAuthentication,
  requirePermission,
} from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { PERMISSIONS } from "../../lib/permissions.js";
import { createSyncEvaluationSchema } from "./schemas.js";
import * as controller from "./controller.js";

export const syncEvaluationsRouter = Router();

syncEvaluationsRouter.use(requireAuthentication);

syncEvaluationsRouter.get(
  "/",
  requirePermission(PERMISSIONS.SYNC_EVAL_VIEW),
  controller.listSyncEvaluations,
);

syncEvaluationsRouter.get(
  "/options/support-links",
  requirePermission(PERMISSIONS.SYNC_EVAL_CREATE),
  controller.listSupportLinks,
);

syncEvaluationsRouter.post(
  "/",
  requirePermission(PERMISSIONS.SYNC_EVAL_CREATE),
  validate(createSyncEvaluationSchema),
  controller.createSyncEvaluation,
);

syncEvaluationsRouter.get(
  "/:id",
  requirePermission(PERMISSIONS.SYNC_EVAL_VIEW),
  controller.getSyncEvaluation,
);
