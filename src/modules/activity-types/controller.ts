import type { NextFunction, Request, Response } from "express";
import type { Actor } from "../../lib/authorization.js";
import { badRequest } from "../../lib/errors.js";
import { listActivityTypesQuerySchema } from "./schemas.js";
import * as service from "./service.js";

function paramId(value: string | string[] | undefined): string {
  const id = Array.isArray(value) ? value[0] : value;
  if (!id) throw badRequest("Missing resource id");
  return id;
}

export async function listActivityTypes(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const query = listActivityTypesQuerySchema.parse(req.query);
    const result = await service.listActivityTypes(req.user as Actor, query);
    res.status(200).json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function createActivityType(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const item = await service.createActivityType(req.user as Actor, req.body);
    res.status(201).json({ data: { activityType: item } });
  } catch (err) {
    next(err);
  }
}

export async function updateActivityType(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const item = await service.updateActivityType(
      req.user as Actor,
      paramId(req.params.id),
      req.body,
    );
    res.status(200).json({ data: { activityType: item } });
  } catch (err) {
    next(err);
  }
}
