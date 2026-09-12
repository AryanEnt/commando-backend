import type { NextFunction, Request, Response } from "express";
import type { Actor } from "../../lib/authorization.js";
import { badRequest } from "../../lib/errors.js";
import {
  endSalesSupportLinkSchema,
  listEligibleSupportUsersQuerySchema,
  listSalesSupportLinksQuerySchema,
} from "./schemas.js";
import * as service from "./service.js";

function paramId(value: string | string[] | undefined): string {
  const id = Array.isArray(value) ? value[0] : value;
  if (!id) throw badRequest("Missing resource id");
  return id;
}

export async function listSalesSupportLinks(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const query = listSalesSupportLinksQuerySchema.parse(req.query);
    const result = await service.listSalesSupportLinks(
      req.user as Actor,
      query,
    );
    res.status(200).json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function listEligibleSupportUsers(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const query = listEligibleSupportUsersQuerySchema.parse(req.query);
    const result = await service.listEligibleSupportUsers(
      req.user as Actor,
      query,
    );
    res.status(200).json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function getTeamContext(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await service.getTeamContext(
      req.user as Actor,
      paramId(req.params.profileId),
    );
    res.status(200).json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function getSalesSupportLink(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const link = await service.getSalesSupportLink(
      req.user as Actor,
      paramId(req.params.id),
    );
    res.status(200).json({ data: { link } });
  } catch (err) {
    next(err);
  }
}

export async function assignSalesSupportLink(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const link = await service.assignSalesSupportLink(
      req.user as Actor,
      req.body,
    );
    res.status(201).json({ data: { link } });
  } catch (err) {
    next(err);
  }
}

export async function endSalesSupportLink(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = endSalesSupportLinkSchema.parse(req.body ?? {});
    const link = await service.endSalesSupportLink(
      req.user as Actor,
      paramId(req.params.id),
      body,
    );
    res.status(200).json({ data: { link } });
  } catch (err) {
    next(err);
  }
}
