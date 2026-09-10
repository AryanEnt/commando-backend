import type { NextFunction, Request, Response } from "express";
import type { Actor } from "../../lib/authorization.js";
import { badRequest } from "../../lib/errors.js";
import { listPerformanceQuerySchema } from "./schemas.js";
import * as service from "./service.js";

function paramId(value: string | string[] | undefined): string {
  const id = Array.isArray(value) ? value[0] : value;
  if (!id) throw badRequest("Missing resource id");
  return id;
}

export async function listPerformance(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const query = listPerformanceQuerySchema.parse(req.query);
    const result = await service.listPerformance(req.user as Actor, query);
    res.status(200).json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function getPerformance(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const evaluation = await service.getPerformance(
      req.user as Actor,
      paramId(req.params.id),
    );
    res.status(200).json({ data: { evaluation } });
  } catch (err) {
    next(err);
  }
}

export async function createPerformance(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const evaluation = await service.createPerformance(
      req.user as Actor,
      req.body,
    );
    res.status(201).json({ data: { evaluation } });
  } catch (err) {
    next(err);
  }
}

export async function getPerformanceMetrics(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const profileId =
      typeof req.query.profileId === "string" ? req.query.profileId : undefined;
    const metrics = await service.getPerformanceMetrics(
      req.user as Actor,
      profileId,
    );
    res.status(200).json({ data: { metrics } });
  } catch (err) {
    next(err);
  }
}
