import type { NextFunction, Request, Response } from "express";
import type { Actor } from "../../lib/authorization.js";
import { badRequest } from "../../lib/errors.js";
import { listAssignmentsQuerySchema } from "./schemas.js";
import * as assignmentService from "./service.js";

function paramId(value: string | string[] | undefined): string {
  const id = Array.isArray(value) ? value[0] : value;
  if (!id) throw badRequest("Missing resource id");
  return id;
}

export async function listAssignments(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const query = listAssignmentsQuerySchema.parse(req.query);
    const result = await assignmentService.listAssignments(
      req.user as Actor,
      query,
    );
    res.status(200).json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function getAssignment(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const assignment = await assignmentService.getAssignment(
      req.user as Actor,
      paramId(req.params.id),
    );
    res.status(200).json({ data: { assignment } });
  } catch (err) {
    next(err);
  }
}

export async function createAssignment(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const assignment = await assignmentService.createAssignment(
      req.user as Actor,
      req.body,
    );
    res.status(201).json({ data: { assignment } });
  } catch (err) {
    next(err);
  }
}

export async function endAssignment(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const assignment = await assignmentService.endAssignment(
      req.user as Actor,
      paramId(req.params.id),
      req.body,
    );
    res.status(200).json({ data: { assignment } });
  } catch (err) {
    next(err);
  }
}

export async function transferAssignment(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const assignment = await assignmentService.transferAssignment(
      req.user as Actor,
      paramId(req.params.id),
      req.body,
    );
    res.status(201).json({ data: { assignment } });
  } catch (err) {
    next(err);
  }
}
