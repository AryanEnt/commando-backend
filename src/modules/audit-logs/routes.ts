import { Router } from "express";
import {
  requireAuthentication,
  requirePermission,
} from "../../middleware/auth.js";
import { PERMISSIONS } from "../../lib/permissions.js";
import * as controller from "./controller.js";

export const auditLogsRouter = Router();

auditLogsRouter.use(requireAuthentication);

auditLogsRouter.get(
  "/",
  requirePermission(PERMISSIONS.AUDIT_VIEW),
  controller.listAuditLogs,
);

auditLogsRouter.get(
  "/facets",
  requirePermission(PERMISSIONS.AUDIT_VIEW),
  controller.getAuditLogFacets,
);

auditLogsRouter.get(
  "/:id",
  requirePermission(PERMISSIONS.AUDIT_VIEW),
  controller.getAuditLog,
);
