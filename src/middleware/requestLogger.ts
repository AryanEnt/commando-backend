import type { NextFunction, Request, Response } from "express";
import { logger } from "../lib/logger.js";

export function requestLogger(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (req.path === "/health" || req.path === "/ready") {
    next();
    return;
  }

  const started = Date.now();
  res.on("finish", () => {
    logger.info("request", {
      method: req.method,
      path: req.originalUrl?.split("?")[0],
      status: res.statusCode,
      ms: Date.now() - started,
      userId: req.user?.id,
    });
  });
  next();
}
