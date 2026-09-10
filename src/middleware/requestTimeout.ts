import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.js";

export function requestTimeout(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  req.setTimeout(env.requestTimeoutMs);
  res.setTimeout(env.requestTimeoutMs);
  next();
}
