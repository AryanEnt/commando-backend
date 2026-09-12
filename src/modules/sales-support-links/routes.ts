import { Router } from "express";
import {
  requireAuthentication,
  requirePermission,
} from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { PERMISSIONS } from "../../lib/permissions.js";
import { assignSalesSupportLinkSchema } from "./schemas.js";
import * as controller from "./controller.js";

export const salesSupportLinksRouter = Router();

salesSupportLinksRouter.use(requireAuthentication);

salesSupportLinksRouter.get(
  "/",
  requirePermission(PERMISSIONS.SALES_SUPPORT_LINK_VIEW),
  controller.listSalesSupportLinks,
);

salesSupportLinksRouter.get(
  "/options/support-users",
  requirePermission(PERMISSIONS.SALES_SUPPORT_LINK_ASSIGN),
  controller.listEligibleSupportUsers,
);

salesSupportLinksRouter.get(
  "/profiles/:profileId/team",
  requirePermission(PERMISSIONS.SALES_SUPPORT_LINK_VIEW),
  controller.getTeamContext,
);

salesSupportLinksRouter.post(
  "/",
  requirePermission(PERMISSIONS.SALES_SUPPORT_LINK_ASSIGN),
  validate(assignSalesSupportLinkSchema),
  controller.assignSalesSupportLink,
);

salesSupportLinksRouter.post(
  "/:id/end",
  requirePermission(PERMISSIONS.SALES_SUPPORT_LINK_ASSIGN),
  controller.endSalesSupportLink,
);

salesSupportLinksRouter.get(
  "/:id",
  requirePermission(PERMISSIONS.SALES_SUPPORT_LINK_VIEW),
  controller.getSalesSupportLink,
);
