import type { NextFunction, Request, Response } from "express";
import type { Actor } from "../../lib/authorization.js";
import { badRequest } from "../../lib/errors.js";
import { listDailyWorkLogsQuerySchema } from "./schemas.js";
import * as service from "./service.js";

function paramId(value: string | string[] | undefined): string {
  const id = Array.isArray(value) ? value[0] : value;
  if (!id) throw badRequest("Missing resource id");
  return id;
}

export async function list(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const query = listDailyWorkLogsQuerySchema.parse(req.query);
    const result = await service.listDailyWorkLogs(req.user as Actor, query);
    res.status(200).json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function getOne(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const log = await service.getDailyWorkLog(
      req.user as Actor,
      paramId(req.params.id),
    );
    res.status(200).json({ data: { log } });
  } catch (err) {
    next(err);
  }
}

export async function create(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const log = await service.createDailyWorkLog(
      req.user as Actor,
      req.body,
    );
    res.status(201).json({ data: { log } });
  } catch (err) {
    next(err);
  }
}

export async function update(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const log = await service.updateDailyWorkLog(
      req.user as Actor,
      paramId(req.params.id),
      req.body,
    );
    res.status(200).json({ data: { log } });
  } catch (err) {
    next(err);
  }
}

export async function remove(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await service.deleteDailyWorkLog(
      req.user as Actor,
      paramId(req.params.id),
    );
    res.status(200).json({ data: result });
  } catch (err) {
    next(err);
  }
}
