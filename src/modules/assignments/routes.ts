import { Router } from "express";
import {
  requireAuthentication,
  requirePermission,
} from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { PERMISSIONS } from "../../lib/permissions.js";
import { createAssignmentSchema, endAssignmentSchema, transferAssignmentSchema } from "./schemas.js";
import * as controller from "./controller.js";

export const assignmentsRouter = Router();

assignmentsRouter.use(requireAuthentication);

assignmentsRouter.get(
  "/",
  requirePermission(PERMISSIONS.ASSIGNMENT_VIEW),
  controller.listAssignments,
);

assignmentsRouter.post(
  "/",
  requirePermission(PERMISSIONS.ASSIGNMENT_CREATE),
  validate(createAssignmentSchema),
  controller.createAssignment,
);

assignmentsRouter.get(
  "/:id",
  requirePermission(PERMISSIONS.ASSIGNMENT_VIEW),
  controller.getAssignment,
);

assignmentsRouter.post(
  "/:id/end",
  requirePermission(PERMISSIONS.ASSIGNMENT_UPDATE),
  validate(endAssignmentSchema),
  controller.endAssignment,
);

assignmentsRouter.post(
  "/:id/transfer",
  requirePermission(PERMISSIONS.ASSIGNMENT_UPDATE),
  validate(transferAssignmentSchema),
  controller.transferAssignment,
);
