import type { NextFunction, Request, Response } from "express";
import type { Actor } from "../../lib/authorization.js";
import { badRequest } from "../../lib/errors.js";
import { listActionItemsQuerySchema } from "./schemas.js";
import * as service from "./service.js";

function paramId(value: string | string[] | undefined): string {
  const id = Array.isArray(value) ? value[0] : value;
  if (!id) throw badRequest("Missing resource id");
  return id;
}

export async function listActionItems(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const query = listActionItemsQuerySchema.parse(req.query);
    const result = await service.listActionItems(req.user as Actor, query);
    res.status(200).json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function getActionItem(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actionItem = await service.getActionItem(
      req.user as Actor,
      paramId(req.params.id),
    );
    res.status(200).json({ data: { actionItem } });
  } catch (err) {
    next(err);
  }
}

export async function createActionItem(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actionItem = await service.createActionItem(
      req.user as Actor,
      req.body,
    );
    res.status(201).json({ data: { actionItem } });
  } catch (err) {
    next(err);
  }
}

export async function updateActionItem(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actionItem = await service.updateActionItem(
      req.user as Actor,
      paramId(req.params.id),
      req.body,
    );
    res.status(200).json({ data: { actionItem } });
  } catch (err) {
    next(err);
  }
}

export async function updateActionItemSummary(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actionItem = await service.updateActionItemSummary(
      req.user as Actor,
      paramId(req.params.id),
      req.body,
    );
    res.status(200).json({ data: { actionItem } });
  } catch (err) {
    next(err);
  }
}

export async function completeActionItem(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actionItem = await service.completeActionItem(
      req.user as Actor,
      paramId(req.params.id),
    );
    res.status(200).json({ data: { actionItem } });
  } catch (err) {
    next(err);
  }
}

export async function expireActionItem(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actionItem = await service.expireActionItem(
      req.user as Actor,
      paramId(req.params.id),
    );
    res.status(200).json({ data: { actionItem } });
  } catch (err) {
    next(err);
  }
}

export async function replaceActionItem(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actionItem = await service.replaceActionItem(
      req.user as Actor,
      paramId(req.params.id),
      req.body,
    );
    res.status(201).json({ data: { actionItem } });
  } catch (err) {
    next(err);
  }
}

export async function addActionItemAttachment(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actionItem = await service.addActionItemAttachment(
      req.user as Actor,
      paramId(req.params.id),
      req.body,
    );
    res.status(201).json({ data: { actionItem } });
  } catch (err) {
    next(err);
  }
}

export async function getActionItemAttachmentUrl(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const data = await service.getActionItemAttachmentUrl(
      req.user as Actor,
      paramId(req.params.id),
      paramId(req.params.attachmentId),
    );
    res.status(200).json({ data });
  } catch (err) {
    next(err);
  }
}

export async function removeActionItemAttachment(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actionItem = await service.removeActionItemAttachment(
      req.user as Actor,
      paramId(req.params.id),
      paramId(req.params.attachmentId),
    );
    res.status(200).json({ data: { actionItem } });
  } catch (err) {
    next(err);
  }
}
