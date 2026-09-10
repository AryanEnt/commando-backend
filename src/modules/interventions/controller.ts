import type { NextFunction, Request, Response } from "express";
import type { Actor } from "../../lib/authorization.js";
import { badRequest } from "../../lib/errors.js";
import { acknowledgeSchema, createGoalSchema } from "./schemas.js";
import * as interventionService from "./service.js";

function paramId(value: string | string[] | undefined): string {
  const id = Array.isArray(value) ? value[0] : value;
  if (!id) throw badRequest("Missing resource id");
  return id;
}

export async function getIntervention(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const data = await interventionService.getIntervention(
      req.user as Actor,
      paramId(req.params.profileId),
    );
    res.status(200).json({ data });
  } catch (err) {
    next(err);
  }
}

export async function getTimeline(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const data = await interventionService.getInterventionTimeline(
      req.user as Actor,
      paramId(req.params.profileId),
    );
    res.status(200).json({ data });
  } catch (err) {
    next(err);
  }
}

export async function acknowledge(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const input = acknowledgeSchema.parse(req.body);
    const acknowledgement = await interventionService.acknowledgeRecord(
      req.user as Actor,
      input,
    );
    res.status(201).json({ data: { acknowledgement } });
  } catch (err) {
    next(err);
  }
}

export async function listGoals(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const goals = await interventionService.listGoals(
      req.user as Actor,
      paramId(req.params.profileId),
    );
    res.status(200).json({ data: { goals } });
  } catch (err) {
    next(err);
  }
}

export async function createGoal(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const input = createGoalSchema.parse(req.body);
    const goal = await interventionService.createGoal(
      req.user as Actor,
      paramId(req.params.profileId),
      input,
    );
    res.status(201).json({ data: { goal } });
  } catch (err) {
    next(err);
  }
}
