import type { NextFunction, Request, Response } from "express";
import type { Actor } from "../../lib/authorization.js";
import { badRequest } from "../../lib/errors.js";
import { listProfilesQuerySchema } from "./schemas.js";
import * as profileService from "./service.js";

function paramId(value: string | string[] | undefined): string {
  const id = Array.isArray(value) ? value[0] : value;
  if (!id) throw badRequest("Missing resource id");
  return id;
}

export async function listProfiles(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const query = listProfilesQuerySchema.parse(req.query);
    const result = await profileService.listProfiles(req.user as Actor, query);
    res.status(200).json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function getProfile(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const profile = await profileService.getProfile(
      req.user as Actor,
      paramId(req.params.id),
    );
    res.status(200).json({ data: { profile } });
  } catch (err) {
    next(err);
  }
}

export async function createProfile(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const profile = await profileService.createProfile(
      req.user as Actor,
      req.body,
    );
    res.status(201).json({ data: { profile } });
  } catch (err) {
    next(err);
  }
}

export async function updateProfile(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const profile = await profileService.updateProfile(
      req.user as Actor,
      paramId(req.params.id),
      req.body,
    );
    res.status(200).json({ data: { profile } });
  } catch (err) {
    next(err);
  }
}
