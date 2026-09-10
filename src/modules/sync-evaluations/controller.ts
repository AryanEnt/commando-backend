import type { NextFunction, Request, Response } from "express";
import type { Actor } from "../../lib/authorization.js";
import { badRequest } from "../../lib/errors.js";
import {
  listSyncEvaluationsQuerySchema,
  supportLinksQuerySchema,
} from "./schemas.js";
import * as service from "./service.js";

function paramId(value: string | string[] | undefined): string {
  const id = Array.isArray(value) ? value[0] : value;
  if (!id) throw badRequest("Missing resource id");
  return id;
}

export async function listSupportLinks(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const query = supportLinksQuerySchema.parse(req.query);
    const links = await service.listSupportLinksForProfile(
      req.user as Actor,
      query.profileId,
    );
    res.status(200).json({ data: { links } });
  } catch (err) {
    next(err);
  }
}

export async function listSyncEvaluations(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const query = listSyncEvaluationsQuerySchema.parse(req.query);
    const result = await service.listSyncEvaluations(req.user as Actor, query);
    res.status(200).json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function getSyncEvaluation(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const evaluation = await service.getSyncEvaluation(
      req.user as Actor,
      paramId(req.params.id),
    );
    res.status(200).json({ data: { evaluation } });
  } catch (err) {
    next(err);
  }
}

export async function createSyncEvaluation(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const evaluation = await service.createSyncEvaluation(
      req.user as Actor,
      req.body,
    );
    res.status(201).json({ data: { evaluation } });
  } catch (err) {
    next(err);
  }
}
