import type { NextFunction, Request, Response } from "express";
import type { Actor } from "../../lib/authorization.js";
import { badRequest } from "../../lib/errors.js";
import { listWeeklyReviewsQuerySchema, weeklyReviewHubQuerySchema } from "./schemas.js";
import * as service from "./service.js";

function paramId(value: string | string[] | undefined): string {
  const id = Array.isArray(value) ? value[0] : value;
  if (!id) throw badRequest("Missing resource id");
  return id;
}

export async function listWeeklyReviews(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const query = listWeeklyReviewsQuerySchema.parse(req.query);
    const result = await service.listWeeklyReviews(req.user as Actor, query);
    res.status(200).json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function getWeeklyReviewHub(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const query = weeklyReviewHubQuerySchema.parse(req.query);
    const hub = await service.getWeeklyReviewHub(req.user as Actor, query);
    res.status(200).json({ data: hub });
  } catch (err) {
    next(err);
  }
}

export async function getWeeklyReview(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const review = await service.getWeeklyReview(
      req.user as Actor,
      paramId(req.params.id),
    );
    res.status(200).json({ data: { review } });
  } catch (err) {
    next(err);
  }
}

export async function createWeeklyReview(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const review = await service.createWeeklyReview(req.user as Actor, req.body);
    res.status(201).json({ data: { review } });
  } catch (err) {
    next(err);
  }
}

export async function updateWeeklyReview(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const review = await service.updateWeeklyReview(
      req.user as Actor,
      paramId(req.params.id),
      req.body,
    );
    res.status(200).json({ data: { review } });
  } catch (err) {
    next(err);
  }
}

export async function submitWeeklyReview(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const review = await service.submitWeeklyReview(
      req.user as Actor,
      paramId(req.params.id),
    );
    res.status(200).json({ data: { review } });
  } catch (err) {
    next(err);
  }
}

export async function acknowledgeWeeklyReview(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const review = await service.acknowledgeWeeklyReview(
      req.user as Actor,
      paramId(req.params.id),
    );
    res.status(200).json({ data: { review } });
  } catch (err) {
    next(err);
  }
}

export async function getMeetingMinutesDownloadUrl(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await service.getMeetingMinutesDownloadUrl(
      req.user as Actor,
      paramId(req.params.id),
    );
    res.status(200).json({ data: result });
  } catch (err) {
    next(err);
  }
}
