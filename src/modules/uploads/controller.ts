import type { NextFunction, Request, Response } from "express";
import type { Actor } from "../../lib/authorization.js";
import { badRequest } from "../../lib/errors.js";
import type { UploadPurpose } from "./schemas.js";
import * as service from "./service.js";

export async function presignUpload(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await service.presignUpload(req.user as Actor, req.body);
    res.status(200).json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function uploadObject(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const meta = (
      req as Request & {
        uploadMeta?: {
          purpose: UploadPurpose;
          fileName: string;
          contentType?: string;
        };
      }
    ).uploadMeta;
    if (!meta) throw badRequest("Missing upload metadata");

    const body = Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.from(req.body ?? []);
    if (body.byteLength === 0) {
      throw badRequest("Empty upload body");
    }

    const contentType =
      meta.contentType ||
      (typeof req.headers["content-type"] === "string"
        ? req.headers["content-type"].split(";")[0]?.trim()
        : "") ||
      "application/octet-stream";

    const result = await service.uploadObject(req.user as Actor, {
      purpose: meta.purpose,
      fileName: meta.fileName,
      contentType,
      body,
    });
    res.status(201).json({ data: result });
  } catch (err) {
    next(err);
  }
}
