import { Router } from "express";
import {
  requireAuthentication,
  requirePermission,
} from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { PERMISSIONS } from "../../lib/permissions.js";
import {
  createWeeklyReviewSchema,
  updateWeeklyReviewSchema,
} from "./schemas.js";
import * as controller from "./controller.js";

export const weeklyReviewsRouter = Router();

weeklyReviewsRouter.use(requireAuthentication);

weeklyReviewsRouter.get(
  "/",
  requirePermission(PERMISSIONS.WEEKLY_REVIEW_VIEW),
  controller.listWeeklyReviews,
);

weeklyReviewsRouter.post(
  "/",
  requirePermission(PERMISSIONS.WEEKLY_REVIEW_CREATE),
  validate(createWeeklyReviewSchema),
  controller.createWeeklyReview,
);

weeklyReviewsRouter.get(
  "/:id",
  requirePermission(PERMISSIONS.WEEKLY_REVIEW_VIEW),
  controller.getWeeklyReview,
);

weeklyReviewsRouter.patch(
  "/:id",
  requirePermission(PERMISSIONS.WEEKLY_REVIEW_EDIT),
  validate(updateWeeklyReviewSchema),
  controller.updateWeeklyReview,
);

/** Named transition — submit locks the review (read-only thereafter). */
weeklyReviewsRouter.post(
  "/:id/submit",
  requirePermission(PERMISSIONS.WEEKLY_REVIEW_SUBMIT),
  controller.submitWeeklyReview,
);

/** Attendee signature / acknowledgement (consistent with referral ack pattern). */
weeklyReviewsRouter.post(
  "/:id/acknowledge",
  requirePermission(PERMISSIONS.WEEKLY_REVIEW_VIEW),
  controller.acknowledgeWeeklyReview,
);
