import { Router } from "express";
import {
  requireAuthentication,
  requirePermission,
} from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { PERMISSIONS } from "../../lib/permissions.js";
import {
  createEisenhowerTaskSchema,
  updateEisenhowerStatusSchema,
  updateEisenhowerTaskSchema,
} from "./schemas.js";
import * as controller from "./controller.js";

export const eisenhowerRouter = Router();

eisenhowerRouter.use(requireAuthentication);

eisenhowerRouter.get(
  "/",
  requirePermission(PERMISSIONS.EISENHOWER_VIEW),
  controller.listTasks,
);

eisenhowerRouter.get(
  "/matrix",
  requirePermission(PERMISSIONS.EISENHOWER_VIEW),
  controller.getMatrix,
);

eisenhowerRouter.post(
  "/",
  requirePermission(PERMISSIONS.EISENHOWER_CREATE),
  validate(createEisenhowerTaskSchema),
  controller.createTask,
);

eisenhowerRouter.get(
  "/:id",
  requirePermission(PERMISSIONS.EISENHOWER_VIEW),
  controller.getTask,
);

eisenhowerRouter.patch(
  "/:id",
  requirePermission(PERMISSIONS.EISENHOWER_UPDATE),
  validate(updateEisenhowerTaskSchema),
  controller.updateTask,
);

eisenhowerRouter.post(
  "/:id/status",
  requirePermission(PERMISSIONS.EISENHOWER_UPDATE),
  validate(updateEisenhowerStatusSchema),
  controller.updateTaskStatus,
);
