import { Router } from "express";
import {
  requireAuthentication,
  requireAnyPermission,
  requirePermission,
} from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { PERMISSIONS } from "../../lib/permissions.js";
import {
  createActionItemSchema,
  replaceActionItemSchema,
  updateActionItemSchema,
  updateActionItemSummarySchema,
  addActionItemAttachmentSchema,
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

actionItemsRouter.patch(
  "/:id/summary",
  requirePermission(PERMISSIONS.ACTION_ITEM_VIEW),
  validate(updateActionItemSummarySchema),
  controller.updateActionItemSummary,
);

/** Named lifecycle transitions — no arbitrary status PATCH. */
actionItemsRouter.post(
  "/:id/complete",
  requireAnyPermission([
    PERMISSIONS.ACTION_ITEM_UPDATE,
    PERMISSIONS.ACTION_ITEM_VIEW,
  ]),
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

actionItemsRouter.post(
  "/:id/attachments",
  requirePermission(PERMISSIONS.ACTION_ITEM_VIEW),
  validate(addActionItemAttachmentSchema),
  controller.addActionItemAttachment,
);

actionItemsRouter.get(
  "/:id/attachments/:attachmentId/url",
  requirePermission(PERMISSIONS.ACTION_ITEM_VIEW),
  controller.getActionItemAttachmentUrl,
);

actionItemsRouter.delete(
  "/:id/attachments/:attachmentId",
  requirePermission(PERMISSIONS.ACTION_ITEM_VIEW),
  controller.removeActionItemAttachment,
);
