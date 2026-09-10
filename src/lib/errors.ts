export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function unauthorized(message = "Authentication required"): AppError {
  return new AppError(401, "UNAUTHORIZED", message);
}

export function forbidden(message = "Insufficient permissions"): AppError {
  return new AppError(403, "FORBIDDEN", message);
}

export function badRequest(message: string, details?: unknown): AppError {
  return new AppError(400, "BAD_REQUEST", message, details);
}

export function notFound(message = "Resource not found"): AppError {
  return new AppError(404, "NOT_FOUND", message);
}

export function conflict(message: string): AppError {
  return new AppError(409, "CONFLICT", message);
}

export function tooManyRequests(message: string): AppError {
  return new AppError(429, "TOO_MANY_REQUESTS", message);
}
