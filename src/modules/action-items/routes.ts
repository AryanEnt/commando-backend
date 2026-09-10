import { Router } from "express";
import {
  requireAuthentication,
  requirePermission,
} from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { PERMISSIONS } from "../../lib/permissions.js";
import {
  createActionItemSchema,
  replaceActionItemSchema,
  updateActionItemSchema,
} from "./schemas.js";
import * as controller from "./controller.js";

export const actionItemsRouter = Router();

actionItemsRouter.use(requireAuthentication);

actionItemsRouter.get(
  "/",
  requirePermission(PERMISSIONS.ACTION_ITEM_VIEW),
  controller.listActionItems,
);

actionItemsRouter.post(
  "/",
  requirePermission(PERMISSIONS.ACTION_ITEM_CREATE),
  validate(createActionItemSchema),
  controller.createActionItem,
);

actionItemsRouter.get(
  "/:id",
  requirePermission(PERMISSIONS.ACTION_ITEM_VIEW),
  controller.getActionItem,
);

actionItemsRouter.patch(
  "/:id",
  requirePermission(PERMISSIONS.ACTION_ITEM_UPDATE),
  validate(updateActionItemSchema),
  controller.updateActionItem,
);

/** Named lifecycle transitions — no arbitrary status PATCH. */
actionItemsRouter.post(
  "/:id/complete",
  requirePermission(PERMISSIONS.ACTION_ITEM_UPDATE),
  controller.completeActionItem,
);

actionItemsRouter.post(
  "/:id/expire",
  requirePermission(PERMISSIONS.ACTION_ITEM_UPDATE),
  controller.expireActionItem,
);

actionItemsRouter.post(
  "/:id/replace",
  requirePermission(PERMISSIONS.ACTION_ITEM_UPDATE),
  validate(replaceActionItemSchema),
  controller.replaceActionItem,
);
