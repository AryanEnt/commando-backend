import { Router } from "express";
import {
  requireAuthentication,
  requirePermission,
} from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { PERMISSIONS } from "../../lib/permissions.js";
import { createFeedbackSchema } from "./schemas.js";
import * as controller from "./controller.js";

export const feedbackRouter = Router();

feedbackRouter.use(requireAuthentication);

feedbackRouter.get(
  "/",
  requirePermission(PERMISSIONS.FEEDBACK_VIEW),
  controller.listFeedback,
);

feedbackRouter.post(
  "/",
  requirePermission(PERMISSIONS.FEEDBACK_CREATE),
  validate(createFeedbackSchema),
  controller.createFeedback,
);

feedbackRouter.post(
  "/:id/acknowledge",
  requirePermission(PERMISSIONS.FEEDBACK_VIEW),
  controller.acknowledgeFeedback,
);

feedbackRouter.get(
  "/:id",
  requirePermission(PERMISSIONS.FEEDBACK_VIEW),
  controller.getFeedback,
);
