import { Router } from "express";
import {
  requireAuthentication,
  requirePermission,
} from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { PERMISSIONS } from "../../lib/permissions.js";
import { presignUploadSchema } from "./schemas.js";
import * as controller from "./controller.js";

export const uploadsRouter = Router();

uploadsRouter.use(requireAuthentication);

uploadsRouter.post(
  "/presign",
  requirePermission(PERMISSIONS.WEEKLY_REVIEW_CREATE),
  validate(presignUploadSchema),
  controller.presignUpload,
);
