import type { NextFunction, Request, Response } from "express";
import { tooManyRequests } from "../lib/errors.js";

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/**
 * Simple in-memory rate limiter for login (and similar public endpoints).
 * Suitable for single-process deployments; use a shared store behind multiple replicas.
 */
export function rateLimit({
  windowMs,
  max,
  keyPrefix = "rl",
}: {
  windowMs: number;
  max: number;
  keyPrefix?: string;
}) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (
      process.env.NODE_ENV === "test" ||
      process.env.VITEST === "true" ||
      process.env.VITEST
    ) {
      next();
      return;
    }
    const ip =
      (typeof req.ip === "string" && req.ip) ||
      req.socket.remoteAddress ||
      "unknown";
    const key = `${keyPrefix}:${ip}`;
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > max) {
      next(
        tooManyRequests(
          "Too many attempts. Please wait and try again.",
        ),
      );
      return;
    }
    next();
  };
}

/** Test helper — clear buckets between cases. */
export function resetRateLimitBuckets(): void {
  buckets.clear();
}
