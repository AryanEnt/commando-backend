import type { NextFunction, Request, Response } from "express";
import type { Actor } from "../../lib/authorization.js";
import { badRequest } from "../../lib/errors.js";
import { listReferralsQuerySchema } from "./schemas.js";
import * as referralService from "./service.js";

function paramId(value: string | string[] | undefined): string {
  const id = Array.isArray(value) ? value[0] : value;
  if (!id) throw badRequest("Missing resource id");
  return id;
}

export async function listCommandos(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const commandos = await referralService.listCommandosForReferral(
      req.user as Actor,
    );
    res.status(200).json({ data: { commandos } });
  } catch (err) {
    next(err);
  }
}

export async function listRequestableProfiles(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const search =
      typeof req.query.search === "string" ? req.query.search : undefined;
    const profiles = await referralService.listRequestableProfiles(
      req.user as Actor,
      search,
    );
    res.status(200).json({ data: { profiles } });
  } catch (err) {
    next(err);
  }
}

export async function listReferrals(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const query = listReferralsQuerySchema.parse(req.query);
    const result = await referralService.listReferrals(
      req.user as Actor,
      query,
    );
    res.status(200).json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function getReferral(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const referral = await referralService.getReferral(
      req.user as Actor,
      paramId(req.params.id),
    );
    res.status(200).json({ data: { referral } });
  } catch (err) {
    next(err);
  }
}

export async function createReferral(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const referral = await referralService.createReferral(
      req.user as Actor,
      req.body,
    );
    res.status(201).json({ data: { referral } });
  } catch (err) {
    next(err);
  }
}

export async function createCommandoRequest(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const referral = await referralService.createCommandoRequest(
      req.user as Actor,
      req.body,
    );
    res.status(201).json({ data: { referral } });
  } catch (err) {
    next(err);
  }
}

export async function provideReferralInformation(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const referral = await referralService.provideReferralInformation(
      req.user as Actor,
      paramId(req.params.id),
      req.body,
    );
    res.status(200).json({ data: { referral } });
  } catch (err) {
    next(err);
  }
}

export async function rejectReferral(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const referral = await referralService.rejectReferral(
      req.user as Actor,
      paramId(req.params.id),
      req.body,
    );
    res.status(200).json({ data: { referral } });
  } catch (err) {
    next(err);
  }
}

export async function acknowledgeReferral(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const referral = await referralService.acknowledgeReferral(
      req.user as Actor,
      paramId(req.params.id),
      typeof req.body?.note === "string" ? req.body.note : null,
    );
    res.status(200).json({ data: { referral } });
  } catch (err) {
    next(err);
  }
}

export async function beginReferral(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const referral = await referralService.beginReferral(
      req.user as Actor,
      paramId(req.params.id),
    );
    res.status(200).json({ data: { referral } });
  } catch (err) {
    next(err);
  }
}

export async function completeReferral(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const referral = await referralService.completeReferral(
      req.user as Actor,
      paramId(req.params.id),
    );
    res.status(200).json({ data: { referral } });
  } catch (err) {
    next(err);
  }
}
