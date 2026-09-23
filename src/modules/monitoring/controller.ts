import type { NextFunction, Request, Response } from "express";
import type { Actor } from "../../lib/authorization.js";
import { badRequest } from "../../lib/errors.js";
import {
  effectiveChecklistQuerySchema,
  listMonitoringCategoriesQuerySchema,
  listMonitoringQuerySchema,
} from "./schemas.js";
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
    const query = listMonitoringCategoriesQuerySchema.parse(req.query);
    const result = await service.listMonitoringCategories(
      req.user as Actor,
      query,
    );
    res.status(200).json({ data: result });
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

export async function deleteCategory(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await service.deleteMonitoringCategory(
      req.user as Actor,
      paramId(req.params.id),
    );
    res.status(200).json({ data: result });
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

export async function getEffectiveChecklist(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const query = effectiveChecklistQuerySchema.parse(req.query);
    const result = await service.getEffectiveChecklist(
      req.user as Actor,
      paramId(req.params.profileId),
      query.categoryId,
    );
    res.status(200).json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function getEffectiveChecklistForExecutive(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const query = effectiveChecklistQuerySchema.parse(req.query);
    const result = await service.getEffectiveChecklistForExecutive(
      req.user as Actor,
      paramId(req.params.userId),
      query.categoryId,
    );
    res.status(200).json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function addSeChecklistItem(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await service.addSeChecklistItem(
      req.user as Actor,
      paramId(req.params.profileId),
      req.body,
    );
    res.status(result.persisted ? 201 : 200).json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function addSeChecklistItemForExecutive(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await service.addSeChecklistItemForExecutive(
      req.user as Actor,
      paramId(req.params.userId),
      req.body,
    );
    res.status(result.persisted ? 201 : 200).json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function removeSeChecklistItem(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const item = await service.removeSeChecklistItem(
      req.user as Actor,
      paramId(req.params.profileId),
      paramId(req.params.itemId),
    );
    res.status(200).json({ data: { item } });
  } catch (err) {
    next(err);
  }
}

export async function removeSeChecklistItemForExecutive(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const item = await service.removeSeChecklistItemForExecutive(
      req.user as Actor,
      paramId(req.params.userId),
      paramId(req.params.itemId),
    );
    res.status(200).json({ data: { item } });
  } catch (err) {
    next(err);
  }
}

export async function removeTemplateItemFromSe(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const item = await service.removeTemplateItemFromSe(
      req.user as Actor,
      paramId(req.params.profileId),
      req.body,
    );
    res.status(200).json({ data: { item } });
  } catch (err) {
    next(err);
  }
}

export async function removeTemplateItemFromExecutive(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const item = await service.removeTemplateItemFromExecutive(
      req.user as Actor,
      paramId(req.params.userId),
      req.body,
    );
    res.status(200).json({ data: { item } });
  } catch (err) {
    next(err);
  }
}

export async function restoreTemplateItemForSe(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await service.restoreTemplateItemForSe(
      req.user as Actor,
      paramId(req.params.profileId),
      req.body,
    );
    res.status(200).json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function restoreTemplateItemForExecutive(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await service.restoreTemplateItemForExecutive(
      req.user as Actor,
      paramId(req.params.userId),
      req.body,
    );
    res.status(200).json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function saveSeChecklistWeights(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await service.saveSeChecklistWeights(
      req.user as Actor,
      paramId(req.params.profileId),
      req.body,
    );
    res.status(200).json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function saveSeChecklistWeightsForExecutive(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await service.saveSeChecklistWeightsForExecutive(
      req.user as Actor,
      paramId(req.params.userId),
      req.body,
    );
    res.status(200).json({ data: result });
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
