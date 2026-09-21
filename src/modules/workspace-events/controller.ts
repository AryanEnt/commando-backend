import type { NextFunction, Request, Response } from "express";
import type { Actor } from "../../lib/authorization.js";
import {
  createWorkspaceEventSchema,
  listWorkspaceEventsQuerySchema,
} from "./schemas.js";
import * as service from "./service.js";

export async function listWorkspaceEvents(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const query = listWorkspaceEventsQuerySchema.parse(req.query);
    const result = await service.listWorkspaceEvents(req.user as Actor, query);
    res.status(200).json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function createWorkspaceEvent(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = createWorkspaceEventSchema.parse(req.body);
    const event = await service.createWorkspaceEvent(req.user as Actor, body);
    res.status(201).json({ data: { event } });
  } catch (err) {
    next(err);
  }
}
