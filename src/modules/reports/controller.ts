import type { NextFunction, Request, Response } from "express";
import type { Actor } from "../../lib/authorization.js";
import { badRequest } from "../../lib/errors.js";
import { listCommandoPerformanceQuerySchema } from "./schemas.js";
import * as service from "./service.js";

function paramId(value: string | string[] | undefined): string {
  const id = Array.isArray(value) ? value[0] : value;
  if (!id) throw badRequest("Missing resource id");
  return id;
}

export async function listCommandoPerformance(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const query = listCommandoPerformanceQuerySchema.parse(req.query);
    const result = await service.listCommandoPerformanceReport(
      req.user as Actor,
      query,
    );
    res.status(200).json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function getCommandoPerformanceDetail(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const report = await service.getCommandoPerformanceReportDetail(
      req.user as Actor,
      paramId(req.params.assignmentId),
    );
    res.status(200).json({ data: { report } });
  } catch (err) {
    next(err);
  }
}

export async function getReportsOverview(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const overview = await service.getReportsOverview(req.user as Actor);
    res.status(200).json({ data: overview });
  } catch (err) {
    next(err);
  }
}
