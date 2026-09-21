import type { NextFunction, Request, Response } from "express";
import type { Actor } from "../../lib/authorization.js";
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
