import { Router } from "express";
import {
  requireAuthentication,
  requirePermission,
} from "../../middleware/auth.js";
import { PERMISSIONS } from "../../lib/permissions.js";
import * as controller from "./controller.js";

export const reportsRouter = Router();

reportsRouter.use(requireAuthentication);

reportsRouter.get(
  "/overview",
  requirePermission(PERMISSIONS.REPORT_VIEW),
  controller.getReportsOverview,
);

reportsRouter.get(
  "/commando-performance",
  requirePermission(PERMISSIONS.REPORT_VIEW),
  controller.listCommandoPerformance,
);

reportsRouter.get(
  "/commando-performance/:assignmentId",
  requirePermission(PERMISSIONS.REPORT_VIEW),
  controller.getCommandoPerformanceDetail,
);
