import type { NextFunction, Request, Response } from "express";
import type { Actor } from "../../lib/authorization.js";
import { badRequest } from "../../lib/errors.js";
import { listMonitoringQuerySchema } from "./schemas.js";
import * as service from "./service.js";

function paramId(value: string | string[] | undefined): string {
  const id = Array.isArray(value) ? value[0] : value;
  if (!id) throw badRequest("Missing resource id");
  return id;
}

export async function listCategories(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const includeInactive = req.query.includeInactive === "true";
    const categories = await service.listMonitoringCategories(
      req.user as Actor,
      includeInactive,
    );
    res.status(200).json({ data: { categories } });
  } catch (err) {
    next(err);
  }
}

export async function createCategory(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const category = await service.createMonitoringCategory(
      req.user as Actor,
      req.body,
    );
    res.status(201).json({ data: { category } });
  } catch (err) {
    next(err);
  }
}

export async function updateCategory(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const category = await service.updateMonitoringCategory(
      req.user as Actor,
      paramId(req.params.id),
      req.body,
    );
    res.status(200).json({ data: { category } });
  } catch (err) {
    next(err);
  }
}

export async function createChecklistItem(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const item = await service.createChecklistItem(
      req.user as Actor,
      paramId(req.params.categoryId),
      req.body,
    );
    res.status(201).json({ data: { item } });
  } catch (err) {
    next(err);
  }
}

export async function updateChecklistItem(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const item = await service.updateChecklistItem(
      req.user as Actor,
      paramId(req.params.id),
      req.body,
    );
    res.status(200).json({ data: { item } });
  } catch (err) {
    next(err);
  }
}

export async function listRecords(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const query = listMonitoringQuerySchema.parse(req.query);
    const result = await service.listMonitoringRecords(
      req.user as Actor,
      query,
    );
    res.status(200).json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function getRecord(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const record = await service.getMonitoringRecord(
      req.user as Actor,
      paramId(req.params.id),
    );
    res.status(200).json({ data: { record } });
  } catch (err) {
    next(err);
  }
}

export async function createRecord(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const record = await service.createMonitoringRecord(
      req.user as Actor,
      req.body,
    );
    res.status(201).json({ data: { record } });
  } catch (err) {
    next(err);
  }
}
