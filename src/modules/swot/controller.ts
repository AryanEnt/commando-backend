import type { NextFunction, Request, Response } from "express";
import type { Actor } from "../../lib/authorization.js";
import { badRequest } from "../../lib/errors.js";
import {
  listSwotQuerySchema,
  setSwotVisibilitySchema,
} from "./schemas.js";
import * as swotService from "./service.js";

function paramId(value: string | string[] | undefined): string {
  const id = Array.isArray(value) ? value[0] : value;
  if (!id) throw badRequest("Missing resource id");
  return id;
}

export async function listSwot(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const query = listSwotQuerySchema.parse(req.query);
    const result = await swotService.listSwot(req.user as Actor, query);
    res.status(200).json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function getSwot(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const item = await swotService.getSwot(
      req.user as Actor,
      paramId(req.params.id),
    );
    res.status(200).json({ data: { swot: item } });
  } catch (err) {
    next(err);
  }
}

export async function createSwot(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const item = await swotService.createSwot(req.user as Actor, req.body);
    res.status(201).json({ data: { swot: item } });
  } catch (err) {
    next(err);
  }
}

export async function setSwotVisibility(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = setSwotVisibilitySchema.parse(req.body);
    const item = await swotService.setSwotVisibility(
      req.user as Actor,
      paramId(req.params.id),
      body,
    );
    res.status(200).json({ data: { swot: item } });
  } catch (err) {
    next(err);
  }
}
