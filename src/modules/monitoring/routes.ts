import { Router } from "express";
import {
  requireAuthentication,
  requirePermission,
  requireAnyPermission,
} from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { PERMISSIONS } from "../../lib/permissions.js";
import {
  addSeChecklistItemSchema,
  createChecklistItemSchema,
  createMonitoringCategorySchema,
  createMonitoringRecordSchema,
  removeSeTemplateItemSchema,
  updateChecklistItemSchema,
  updateMonitoringCategorySchema,
} from "./schemas.js";
import * as controller from "./controller.js";

export const monitoringRouter = Router();

monitoringRouter.use(requireAuthentication);

monitoringRouter.get(
  "/categories",
  requireAnyPermission([
    PERMISSIONS.MONITORING_VIEW,
    PERMISSIONS.MONITORING_CREATE,
    PERMISSIONS.MONITORING_CHECKLIST_MANAGE,
  ]),
  controller.listCategories,
);

monitoringRouter.post(
  "/categories",
  requirePermission(PERMISSIONS.MONITORING_CHECKLIST_MANAGE),
  validate(createMonitoringCategorySchema),
  controller.createCategory,
);

monitoringRouter.patch(
  "/categories/:id",
  requirePermission(PERMISSIONS.MONITORING_CHECKLIST_MANAGE),
  validate(updateMonitoringCategorySchema),
  controller.updateCategory,
);

monitoringRouter.post(
  "/categories/:categoryId/items",
  requirePermission(PERMISSIONS.MONITORING_CHECKLIST_MANAGE),
  validate(createChecklistItemSchema),
  controller.createChecklistItem,
);

monitoringRouter.patch(
  "/checklist-items/:id",
  requirePermission(PERMISSIONS.MONITORING_CHECKLIST_MANAGE),
  validate(updateChecklistItemSchema),
  controller.updateChecklistItem,
);

monitoringRouter.get(
  "/",
  requirePermission(PERMISSIONS.MONITORING_VIEW),
  controller.listRecords,
);

monitoringRouter.post(
  "/",
  requirePermission(PERMISSIONS.MONITORING_CREATE),
  validate(createMonitoringRecordSchema),
  controller.createRecord,
);

// SE checklist customization — before /:id catch-all
monitoringRouter.get(
  "/profiles/:profileId/checklist",
  requireAnyPermission([
    PERMISSIONS.MONITORING_VIEW,
    PERMISSIONS.MONITORING_CREATE,
  ]),
  controller.getEffectiveChecklist,
);

monitoringRouter.post(
  "/profiles/:profileId/checklist/items",
  requirePermission(PERMISSIONS.MONITORING_CREATE),
  validate(addSeChecklistItemSchema),
  controller.addSeChecklistItem,
);

monitoringRouter.delete(
  "/profiles/:profileId/checklist/items/:itemId",
  requirePermission(PERMISSIONS.MONITORING_CREATE),
  controller.removeSeChecklistItem,
);

monitoringRouter.post(
  "/profiles/:profileId/checklist/remove-template",
  requirePermission(PERMISSIONS.MONITORING_CREATE),
  validate(removeSeTemplateItemSchema),
  controller.removeTemplateItemFromSe,
);

monitoringRouter.post(
  "/profiles/:profileId/checklist/restore-template",
  requirePermission(PERMISSIONS.MONITORING_CREATE),
  validate(removeSeTemplateItemSchema),
  controller.restoreTemplateItemForSe,
);

monitoringRouter.get(
  "/:id",
  requirePermission(PERMISSIONS.MONITORING_VIEW),
  controller.getRecord,
);
