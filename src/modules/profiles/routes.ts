import { Router } from "express";
import {
  requireAuthentication,
  requirePermission,
} from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { PERMISSIONS } from "../../lib/permissions.js";
import { createProfileSchema, updateProfileSchema } from "./schemas.js";
import * as controller from "./controller.js";

export const profilesRouter = Router();

profilesRouter.use(requireAuthentication);

profilesRouter.get(
  "/",
  requirePermission(PERMISSIONS.PROFILE_VIEW),
  controller.listProfiles,
);

profilesRouter.post(
  "/",
  requirePermission(PERMISSIONS.PROFILE_MANAGE),
  validate(createProfileSchema),
  controller.createProfile,
);

profilesRouter.get(
  "/:id",
  requirePermission(PERMISSIONS.PROFILE_VIEW),
  controller.getProfile,
);

profilesRouter.patch(
  "/:id",
  requirePermission(PERMISSIONS.PROFILE_MANAGE),
  validate(updateProfileSchema),
  controller.updateProfile,
);
