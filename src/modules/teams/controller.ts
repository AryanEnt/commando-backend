import type { NextFunction, Request, Response } from "express";
import type { Actor } from "../../lib/authorization.js";
import { badRequest } from "../../lib/errors.js";
import * as teamService from "./service.js";

function paramId(value: string | string[] | undefined): string {
  const id = Array.isArray(value) ? value[0] : value;
  if (!id) throw badRequest("Missing resource id");
  return id;
}

export async function listTeams(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const search =
      typeof req.query.search === "string" ? req.query.search : undefined;
    const teams = await teamService.listTeams(req.user as Actor, search);
    res.status(200).json({ data: { teams } });
  } catch (err) {
    next(err);
  }
}

export async function getTeam(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const team = await teamService.getTeam(
      req.user as Actor,
      paramId(req.params.id),
    );
    res.status(200).json({ data: { team } });
  } catch (err) {
    next(err);
  }
}

export async function createTeam(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const team = await teamService.createTeam(req.user as Actor, req.body);
    res.status(201).json({ data: { team } });
  } catch (err) {
    next(err);
  }
}

export async function updateTeam(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const team = await teamService.updateTeam(
      req.user as Actor,
      paramId(req.params.id),
      req.body,
    );
    res.status(200).json({ data: { team } });
  } catch (err) {
    next(err);
  }
}

export async function listMembers(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const members = await teamService.listMembers(
      req.user as Actor,
      paramId(req.params.id),
    );
    res.status(200).json({ data: { members } });
  } catch (err) {
    next(err);
  }
}

export async function addMember(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const membership = await teamService.addMember(
      req.user as Actor,
      paramId(req.params.id),
      req.body,
    );
    res.status(201).json({ data: { membership } });
  } catch (err) {
    next(err);
  }
}

export async function endMember(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const membership = await teamService.endMember(
      req.user as Actor,
      paramId(req.params.id),
      paramId(req.params.membershipId),
      req.body?.endedAt,
    );
    res.status(200).json({ data: { membership } });
  } catch (err) {
    next(err);
  }
}
