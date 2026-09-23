import type { NextFunction, Request, Response } from "express";
import type { Actor } from "../../lib/authorization.js";
import { badRequest } from "../../lib/errors.js";
import { listSupportTasksQuerySchema } from "./schemas.js";
import * as service from "./service.js";

function paramId(value: string | string[] | undefined): string {
  const id = Array.isArray(value) ? value[0] : value;
  if (!id) throw badRequest("Missing resource id");
  return id;
}

export async function listSupportTasks(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const query = listSupportTasksQuerySchema.parse(req.query);
    const result = await service.listSupportTasks(req.user as Actor, query);
    res.status(200).json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function getSupportTask(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const task = await service.getSupportTask(
      req.user as Actor,
      paramId(req.params.id),
    );
    res.status(200).json({ data: { task } });
  } catch (err) {
    next(err);
  }
}

export async function createSupportTask(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const task = await service.createSupportTask(
      req.user as Actor,
      req.body,
    );
    res.status(201).json({ data: { task } });
  } catch (err) {
    next(err);
  }
}

export async function updateSupportTask(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const task = await service.updateSupportTask(
      req.user as Actor,
      paramId(req.params.id),
      req.body,
    );
    res.status(200).json({ data: { task } });
  } catch (err) {
    next(err);
  }
}

export async function updateSupportTaskStatus(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const task = await service.updateSupportTaskStatus(
      req.user as Actor,
      paramId(req.params.id),
      req.body,
    );
    res.status(200).json({ data: { task } });
  } catch (err) {
    next(err);
  }
}

export async function addSupportTaskProgressNote(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const task = await service.addSupportTaskProgressNote(
      req.user as Actor,
      paramId(req.params.id),
      req.body,
    );
    res.status(200).json({ data: { task } });
  } catch (err) {
    next(err);
  }
}

export async function addSupportTaskAttachment(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const task = await service.addSupportTaskAttachment(
      req.user as Actor,
      paramId(req.params.id),
      req.body,
    );
    res.status(201).json({ data: { task } });
  } catch (err) {
    next(err);
  }
}

export async function getSupportTaskAttachmentUrl(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const data = await service.getSupportTaskAttachmentUrl(
      req.user as Actor,
      paramId(req.params.id),
      paramId(req.params.attachmentId),
    );
    res.status(200).json({ data });
  } catch (err) {
    next(err);
  }
}

export async function removeSupportTaskAttachment(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const task = await service.removeSupportTaskAttachment(
      req.user as Actor,
      paramId(req.params.id),
      paramId(req.params.attachmentId),
    );
    res.status(200).json({ data: { task } });
  } catch (err) {
    next(err);
  }
}
