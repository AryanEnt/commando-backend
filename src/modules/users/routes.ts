import { Router } from "express";
import {
  requireAuthentication,
  requireAnyPermission,
  requirePermission,
} from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { rateLimit } from "../../middleware/rateLimit.js";
import { PERMISSIONS } from "../../lib/permissions.js";
import {
  createSalesExecutiveSchema,
  createUserSchema,
  updateUserRoleSchema,
  updateUserSchema,
  updateUserStatusSchema,
} from "./schemas.js";
import * as controller from "./controller.js";

export const usersRouter = Router();

usersRouter.use(requireAuthentication);

usersRouter.get(
  "/",
  requirePermission(PERMISSIONS.USER_VIEW),
  controller.listUsers,
);

usersRouter.post(
  "/",
  requireAnyPermission([
    PERMISSIONS.USER_CREATE,
    PERMISSIONS.SALES_SUPPORT_CREATE,
  ]),
  rateLimit({
    windowMs: 60_000,
    max: 20,
    keyPrefix: "user-create",
  }),
  validate(createUserSchema),
  controller.createUser,
);

usersRouter.post(
  "/sales-executives",
  requirePermission(PERMISSIONS.SALES_EXECUTIVE_CREATE),
  rateLimit({
    windowMs: 60_000,
    max: 20,
    keyPrefix: "se-onboard",
  }),
  validate(createSalesExecutiveSchema),
  controller.createSalesExecutive,
);

usersRouter.get(
  "/:id",
  requirePermission(PERMISSIONS.USER_VIEW),
  controller.getUser,
);

usersRouter.get(
  "/:id/profile",
  requirePermission(PERMISSIONS.USER_VIEW),
  controller.getUserProfile,
);

usersRouter.patch(
  "/:id",
  requirePermission(PERMISSIONS.USER_UPDATE),
  validate(updateUserSchema),
  controller.updateUser,
);

usersRouter.patch(
  "/:id/status",
  requirePermission(PERMISSIONS.USER_STATUS_UPDATE),
  validate(updateUserStatusSchema),
  controller.changeUserStatus,
);

usersRouter.patch(
  "/:id/role",
  requirePermission(PERMISSIONS.USER_ROLE_UPDATE),
  validate(updateUserRoleSchema),
  controller.changeUserRole,
);

export const rolesRouter = Router();

rolesRouter.use(requireAuthentication);

rolesRouter.get(
  "/",
  requirePermission(PERMISSIONS.ROLE_VIEW),
  controller.listRoles,
);

export const permissionsRouter = Router();

permissionsRouter.use(requireAuthentication);

permissionsRouter.get(
  "/",
  requirePermission(PERMISSIONS.PERMISSION_VIEW),
  controller.listPermissions,
);
