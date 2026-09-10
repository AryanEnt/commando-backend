import { Router } from "express";
import {
  requireAuthentication,
  requirePermission,
} from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { PERMISSIONS } from "../../lib/permissions.js";
import {
  createCommandoRequestSchema,
  createReferralSchema,
  provideReferralInformationSchema,
  rejectReferralSchema,
} from "./schemas.js";
import * as controller from "./controller.js";

export const referralsRouter = Router();

referralsRouter.use(requireAuthentication);

referralsRouter.get(
  "/",
  requirePermission(PERMISSIONS.REFERRAL_VIEW),
  controller.listReferrals,
);

referralsRouter.get(
  "/options/commandos",
  requirePermission(PERMISSIONS.REFERRAL_CREATE),
  controller.listCommandos,
);

referralsRouter.get(
  "/options/requestable-profiles",
  requirePermission(PERMISSIONS.REFERRAL_VIEW),
  controller.listRequestableProfiles,
);

referralsRouter.post(
  "/request",
  requirePermission(PERMISSIONS.REFERRAL_VIEW),
  validate(createCommandoRequestSchema),
  controller.createCommandoRequest,
);

referralsRouter.post(
  "/",
  requirePermission(PERMISSIONS.REFERRAL_CREATE),
  validate(createReferralSchema),
  controller.createReferral,
);

referralsRouter.get(
  "/:id",
  requirePermission(PERMISSIONS.REFERRAL_VIEW),
  controller.getReferral,
);

/** Named transitions only — no arbitrary status PATCH. */
referralsRouter.post(
  "/:id/acknowledge",
  requirePermission(PERMISSIONS.REFERRAL_ACKNOWLEDGE),
  controller.acknowledgeReferral,
);

referralsRouter.post(
  "/:id/provide-information",
  requirePermission(PERMISSIONS.REFERRAL_VIEW),
  validate(provideReferralInformationSchema),
  controller.provideReferralInformation,
);

referralsRouter.post(
  "/:id/reject",
  requirePermission(PERMISSIONS.REFERRAL_VIEW),
  validate(rejectReferralSchema),
  controller.rejectReferral,
);

referralsRouter.post(
  "/:id/begin",
  requirePermission(PERMISSIONS.REFERRAL_UPDATE_STATUS),
  controller.beginReferral,
);

referralsRouter.post(
  "/:id/complete",
  requirePermission(PERMISSIONS.REFERRAL_UPDATE_STATUS),
  controller.completeReferral,
);
