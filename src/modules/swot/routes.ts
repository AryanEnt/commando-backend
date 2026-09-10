import { Router } from "express";
import {
  requireAuthentication,
  requirePermission,
} from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { PERMISSIONS } from "../../lib/permissions.js";
import { createSwotSchema } from "./schemas.js";
import * as controller from "./controller.js";

export const swotRouter = Router();

swotRouter.use(requireAuthentication);

swotRouter.get(
  "/",
  requirePermission(PERMISSIONS.SWOT_VIEW),
  controller.listSwot,
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
