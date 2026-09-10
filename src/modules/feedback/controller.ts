import type { NextFunction, Request, Response } from "express";
import type { Actor } from "../../lib/authorization.js";
import { badRequest } from "../../lib/errors.js";
import { listFeedbackQuerySchema } from "./schemas.js";
import * as service from "./service.js";

function paramId(value: string | string[] | undefined): string {
  const id = Array.isArray(value) ? value[0] : value;
  if (!id) throw badRequest("Missing resource id");
  return id;
}

export async function listFeedback(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const query = listFeedbackQuerySchema.parse(req.query);
    const result = await service.listFeedback(req.user as Actor, query);
    res.status(200).json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function getFeedback(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const feedback = await service.getFeedback(
      req.user as Actor,
      paramId(req.params.id),
    );
    res.status(200).json({ data: { feedback } });
  } catch (err) {
    next(err);
  }
}

export async function createFeedback(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const feedback = await service.createFeedback(req.user as Actor, req.body);
    res.status(201).json({ data: { feedback } });
  } catch (err) {
    next(err);
  }
}
