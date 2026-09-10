import { Router } from "express";
import {
  requireAuthentication,
  requirePermission,
} from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { PERMISSIONS } from "../../lib/permissions.js";
import { createPerformanceSchema } from "./schemas.js";
import * as controller from "./controller.js";

export const performanceRouter = Router();

performanceRouter.use(requireAuthentication);

performanceRouter.get(
  "/",
  requirePermission(PERMISSIONS.PERFORMANCE_VIEW),
  controller.listPerformance,
);

performanceRouter.post(
  "/",
  requirePermission(PERMISSIONS.PERFORMANCE_CREATE),
  validate(createPerformanceSchema),
  controller.createPerformance,
);

/** Dashboard metrics — must be registered before /:id */
performanceRouter.get(
  "/metrics",
  requirePermission(PERMISSIONS.PERFORMANCE_VIEW),
  controller.getPerformanceMetrics,
);

performanceRouter.get(
  "/:id",
  requirePermission(PERMISSIONS.PERFORMANCE_VIEW),
  controller.getPerformance,
);
