import { Router } from "express";
import {
  requireAuthentication,
  requirePermission,
} from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { PERMISSIONS } from "../../lib/permissions.js";
import {
  createSupportTaskSchema,
  updateSupportTaskSchema,
  updateSupportTaskStatusSchema,
  addSupportTaskProgressNoteSchema,
} from "./schemas.js";
import * as controller from "./controller.js";

export const supportTasksRouter = Router();

supportTasksRouter.use(requireAuthentication);

supportTasksRouter.get(
  "/",
  requirePermission(PERMISSIONS.SALES_SUPPORT_TASK_VIEW),
  controller.listSupportTasks,
);

supportTasksRouter.post(
  "/",
  requirePermission(PERMISSIONS.SALES_SUPPORT_TASK_CREATE),
  validate(createSupportTaskSchema),
  controller.createSupportTask,
);

supportTasksRouter.get(
  "/:id",
  requirePermission(PERMISSIONS.SALES_SUPPORT_TASK_VIEW),
  controller.getSupportTask,
);

supportTasksRouter.patch(
  "/:id",
  requirePermission(PERMISSIONS.SALES_SUPPORT_TASK_UPDATE),
  validate(updateSupportTaskSchema),
  controller.updateSupportTask,
);

supportTasksRouter.patch(
  "/:id/status",
  requirePermission(PERMISSIONS.SALES_SUPPORT_TASK_STATUS_UPDATE),
  validate(updateSupportTaskStatusSchema),
  controller.updateSupportTaskStatus,
);

supportTasksRouter.post(
  "/:id/progress-notes",
  requirePermission(PERMISSIONS.SALES_SUPPORT_TASK_VIEW),
  validate(addSupportTaskProgressNoteSchema),
  controller.addSupportTaskProgressNote,
);
