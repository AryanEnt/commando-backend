import type { NextFunction, Request, Response } from "express";
import type { Actor } from "../../lib/authorization.js";
import { badRequest } from "../../lib/errors.js";
import { listAuditLogsQuerySchema } from "./schemas.js";
import * as service from "./service.js";

function paramId(value: string | string[] | undefined): string {
  const id = Array.isArray(value) ? value[0] : value;
  if (!id) throw badRequest("Missing resource id");
  return id;
}

export async function listAuditLogs(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const query = listAuditLogsQuerySchema.parse(req.query);
    const result = await service.listAuditLogs(req.user as Actor, query);
    res.status(200).json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function getAuditLog(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const item = await service.getAuditLog(
      req.user as Actor,
      paramId(req.params.id),
    );
    res.status(200).json({ data: { auditLog: item } });
  } catch (err) {
    next(err);
  }
}

export async function getAuditLogFacets(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const facets = await service.getAuditLogFacets(req.user as Actor);
    res.status(200).json({ data: { facets } });
  } catch (err) {
    next(err);
  }
}
