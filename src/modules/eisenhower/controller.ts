import type { NextFunction, Request, Response } from "express";
import type { Actor } from "../../lib/authorization.js";
import { badRequest } from "../../lib/errors.js";
import {
  listEisenhowerQuerySchema,
  monthInputSchema,
} from "./schemas.js";
import * as service from "./service.js";
import { z } from "zod";

function paramId(value: string | string[] | undefined): string {
  const id = Array.isArray(value) ? value[0] : value;
  if (!id) throw badRequest("Missing resource id");
  return id;
}

const matrixQuerySchema = z.object({
  profileId: z.string().optional(),
  month: monthInputSchema.optional(),
});

export async function listTasks(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const query = listEisenhowerQuerySchema.parse(req.query);
    const result = await service.listEisenhowerTasks(req.user as Actor, query);
    res.status(200).json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function getMatrix(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const query = matrixQuerySchema.parse(req.query);
    const result = await service.getEisenhowerMatrix(req.user as Actor, query);
    res.status(200).json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function getTask(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const task = await service.getEisenhowerTask(
      req.user as Actor,
      paramId(req.params.id),
    );
    res.status(200).json({ data: { task } });
  } catch (err) {
    next(err);
  }
}

export async function createTask(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const task = await service.createEisenhowerTask(
      req.user as Actor,
      req.body,
    );
    res.status(201).json({ data: { task } });
  } catch (err) {
    next(err);
  }
}

export async function updateTask(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const task = await service.updateEisenhowerTask(
      req.user as Actor,
      paramId(req.params.id),
      req.body,
    );
    res.status(200).json({ data: { task } });
  } catch (err) {
    next(err);
  }
}

export async function updateTaskStatus(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const task = await service.updateEisenhowerTaskStatus(
      req.user as Actor,
      paramId(req.params.id),
      req.body,
    );
    res.status(200).json({ data: { task } });
  } catch (err) {
    next(err);
  }
}
