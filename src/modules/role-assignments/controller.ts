import type { NextFunction, Request, Response } from "express";
import type { Actor } from "../../lib/authorization.js";
import { badRequest } from "../../lib/errors.js";
import { listRoleAssignmentsQuerySchema } from "./schemas.js";
import * as service from "./service.js";

function paramId(value: string | string[] | undefined): string {
  const id = Array.isArray(value) ? value[0] : value;
  if (!id) throw badRequest("Missing resource id");
  return id;
}

export async function getTemplates(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.status(200).json({
      data: { templates: service.getRoleAssignmentTemplates() },
    });
  } catch (err) {
    next(err);
  }
}

export async function listRoleAssignments(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const query = listRoleAssignmentsQuerySchema.parse(req.query);
    const result = await service.listRoleAssignments(req.user as Actor, query);
    res.status(200).json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function getRoleAssignment(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const roleAssignment = await service.getRoleAssignment(
      req.user as Actor,
      paramId(req.params.id),
    );
    res.status(200).json({ data: { roleAssignment } });
  } catch (err) {
    next(err);
  }
}

export async function createRoleAssignment(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const roleAssignment = await service.createRoleAssignment(
      req.user as Actor,
      req.body,
    );
    res.status(201).json({ data: { roleAssignment } });
  } catch (err) {
    next(err);
  }
}

export async function updateRoleAssignment(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const roleAssignment = await service.updateRoleAssignment(
      req.user as Actor,
      paramId(req.params.id),
      req.body,
    );
    res.status(200).json({ data: { roleAssignment } });
  } catch (err) {
    next(err);
  }
}
