import { Router } from "express";
import {
  requireAuthentication,
  requirePermission,
} from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { PERMISSIONS } from "../../lib/permissions.js";
import {
  addSwotPointSchema,
  createSwotSchema,
  setSwotVisibilitySchema,
  updateSwotPointSchema,
} from "./schemas.js";
import * as controller from "./controller.js";

export const swotRouter = Router();

swotRouter.use(requireAuthentication);

swotRouter.get(
  "/",
  requirePermission(PERMISSIONS.SWOT_VIEW),
  controller.listSwot,
);

swotRouter.get(
  "/support-subjects",
  requirePermission(PERMISSIONS.SWOT_CREATE),
  controller.listSupportSubjects,
);

swotRouter.post(
  "/",
  requirePermission(PERMISSIONS.SWOT_CREATE),
  validate(createSwotSchema),
  controller.createSwot,
);

swotRouter.get(
  "/:id",
  requirePermission(PERMISSIONS.SWOT_VIEW),
  controller.getSwot,
);

swotRouter.patch(
  "/:id/visibility",
  requirePermission(PERMISSIONS.SWOT_CREATE),
  validate(setSwotVisibilitySchema),
  controller.setSwotVisibility,
);

// Super Admin point corrections (role enforced in the service).
swotRouter.post(
  "/:id/points",
  requirePermission(PERMISSIONS.SWOT_VIEW),
  validate(addSwotPointSchema),
  controller.addSwotPoint,
);

swotRouter.patch(
  "/:id/points/:pointId",
  requirePermission(PERMISSIONS.SWOT_VIEW),
  validate(updateSwotPointSchema),
  controller.updateSwotPoint,
);

swotRouter.delete(
  "/:id/points/:pointId",
  requirePermission(PERMISSIONS.SWOT_VIEW),
  controller.deleteSwotPoint,
);
