import { Router } from "express";
import {
  requireAuthentication,
  requirePermission,
} from "../../middleware/auth.js";
import { PERMISSIONS } from "../../lib/permissions.js";
import * as controller from "./controller.js";

export const dashboardRouter = Router();

dashboardRouter.use(requireAuthentication);

dashboardRouter.get(
  "/control-tower",
  requirePermission(PERMISSIONS.DASHBOARD_VIEW),
  controller.getControlTower,
);

dashboardRouter.get(
  "/organization",
  requirePermission(PERMISSIONS.TEAM_VIEW),
  controller.getOrganization,
);
