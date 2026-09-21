import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { AppError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";

function isZodError(err: unknown): err is ZodError {
  if (err instanceof ZodError) return true;
  return Boolean(
    err &&
      typeof err === "object" &&
      "name" in err &&
      (err as { name: string }).name === "ZodError" &&
      "issues" in err,
  );
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      logger.error("app_error", { code: err.code, message: err.message });
    }
    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
      },
    });
    return;
  }

  if (isZodError(err)) {
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed",
        details: err.flatten?.() ?? { issues: err.issues },
      },
    });
    return;
  }

  if (err instanceof Prisma.PrismaClientValidationError) {
    const message = err.message;
    logger.error("prisma_validation_error", { error: message });
    const schemaMismatch =
      /Unknown (argument|field)|Available options are marked/i.test(message);
    res.status(schemaMismatch ? 503 : 400).json({
      error: {
        code: schemaMismatch ? "SCHEMA_MISMATCH" : "BAD_REQUEST",
        message: schemaMismatch
          ? "Database client is out of date. Run prisma generate, migrate deploy, rebuild, and restart the API."
          : "Invalid data for this operation",
      },
    });
    return;
  }

  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    (err.code === "P2022" || err.code === "P2010")
  ) {
    logger.error("prisma_schema_error", {
      code: err.code,
      meta: err.meta,
      message: err.message,
    });
    res.status(503).json({
      error: {
        code: "SCHEMA_MISMATCH",
        message:
          "Database schema is missing required columns. Run prisma migrate deploy and restart the API.",
      },
    });
    return;
  }

  logger.error("unhandled_error", {
    error: err instanceof Error ? err.message : "unknown",
    name: err instanceof Error ? err.name : undefined,
    stack: err instanceof Error ? err.stack : undefined,
  });
  res.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred",
    },
  });
}
