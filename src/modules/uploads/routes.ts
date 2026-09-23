import { Router, raw } from "express";
import { z } from "zod";
import { requireAuthentication } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { badRequest } from "../../lib/errors.js";
import { UPLOAD_PURPOSES, presignUploadSchema } from "./schemas.js";
import * as controller from "./controller.js";

export const uploadsRouter = Router();

uploadsRouter.use(requireAuthentication);

uploadsRouter.post(
  "/presign",
  validate(presignUploadSchema),
  controller.presignUpload,
);

const directUploadQuerySchema = z.object({
  purpose: z.enum(UPLOAD_PURPOSES),
  fileName: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(128).optional(),
});

uploadsRouter.post(
  "/object",
  raw({ type: () => true, limit: "10mb" }),
  (req, _res, next) => {
    const parsed = directUploadQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      next(badRequest(parsed.error.issues[0]?.message ?? "Invalid upload query"));
      return;
    }
    (req as typeof req & { uploadMeta: z.infer<typeof directUploadQuerySchema> }).uploadMeta =
      parsed.data;
    next();
  },
  controller.uploadObject,
);
