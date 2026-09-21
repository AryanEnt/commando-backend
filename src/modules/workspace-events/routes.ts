import { Router } from "express";
import {
  requireAuthentication,
  requirePermission,
} from "../../middleware/auth.js";
import { PERMISSIONS } from "../../lib/permissions.js";
import * as controller from "./controller.js";

export const workspaceEventsRouter = Router();

workspaceEventsRouter.use(requireAuthentication);

workspaceEventsRouter.get(
  "/",
  requirePermission(PERMISSIONS.PROFILE_VIEW),
  controller.listWorkspaceEvents,
);

workspaceEventsRouter.post(
  "/",
  requirePermission(PERMISSIONS.PROFILE_VIEW),
  controller.createWorkspaceEvent,
);
