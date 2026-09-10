import type { NextFunction, Request, Response } from "express";
import type { Actor } from "../../lib/authorization.js";
import { badRequest } from "../../lib/errors.js";
import { listDailyLogsQuerySchema } from "./schemas.js";
import * as service from "./service.js";

function paramId(value: string | string[] | undefined): string {
  const id = Array.isArray(value) ? value[0] : value;
  if (!id) throw badRequest("Missing resource id");
  return id;
}

export async function listDailyLogs(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const query = listDailyLogsQuerySchema.parse(req.query);
    const result = await service.listDailyLogs(req.user as Actor, query);
    res.status(200).json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function getDailyLog(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const log = await service.getDailyLog(
      req.user as Actor,
      paramId(req.params.id),
    );
    res.status(200).json({ data: { log } });
  } catch (err) {
    next(err);
  }
}

export async function createDailyLog(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const log = await service.createDailyLog(req.user as Actor, req.body);
    res.status(201).json({ data: { log } });
  } catch (err) {
    next(err);
  }
}
