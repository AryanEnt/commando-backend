import { Router } from "express";
import {
  requireAuthentication,
  requirePermission,
} from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { PERMISSIONS } from "../../lib/permissions.js";
import {
  createRoleAssignmentSchema,
  updateRoleAssignmentSchema,
} from "./schemas.js";
import * as controller from "./controller.js";

export const roleAssignmentsRouter = Router();

roleAssignmentsRouter.use(requireAuthentication);

roleAssignmentsRouter.get(
  "/templates",
  requirePermission(PERMISSIONS.ROLE_ASSIGNMENT_CREATE),
  controller.getTemplates,
);

roleAssignmentsRouter.get(
  "/",
  requirePermission(PERMISSIONS.ROLE_ASSIGNMENT_VIEW),
  controller.listRoleAssignments,
);

roleAssignmentsRouter.post(
  "/",
  requirePermission(PERMISSIONS.ROLE_ASSIGNMENT_CREATE),
  validate(createRoleAssignmentSchema),
  controller.createRoleAssignment,
);

roleAssignmentsRouter.get(
  "/:id",
  requirePermission(PERMISSIONS.ROLE_ASSIGNMENT_VIEW),
  controller.getRoleAssignment,
);

roleAssignmentsRouter.patch(
  "/:id",
  requirePermission(PERMISSIONS.ROLE_ASSIGNMENT_EDIT),
  validate(updateRoleAssignmentSchema),
  controller.updateRoleAssignment,
);
