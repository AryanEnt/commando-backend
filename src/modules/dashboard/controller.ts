import type { NextFunction, Request, Response } from "express";
import type { Actor } from "../../lib/authorization.js";
import * as dashboardService from "./service.js";

export async function getControlTower(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const data = await dashboardService.getControlTower(req.user as Actor);
    res.status(200).json({ data });
  } catch (err) {
    next(err);
  }
}

export async function getOrganization(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const data = await dashboardService.getOrganizationStructure(
      req.user as Actor,
    );
    res.status(200).json({ data });
  } catch (err) {
    next(err);
  }
}
