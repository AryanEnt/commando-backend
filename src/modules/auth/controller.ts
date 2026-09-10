import type { NextFunction, Request, Response } from "express";
import * as authService from "./service.js";

function readRefreshToken(req: Request): string | undefined {
  const fromBody =
    typeof req.body?.refreshToken === "string"
      ? req.body.refreshToken
      : undefined;
  const fromCookie = req.cookies?.[authService.REFRESH_COOKIE] as
    | string
    | undefined;
  return fromBody || fromCookie || undefined;
}

export async function login(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await authService.login(req.body);
    authService.setAuthCookies(res, result.accessToken, result.refreshToken);
    res.status(200).json({
      data: {
        user: result.user,
        accessToken: result.accessToken,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function refresh(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const refreshToken = readRefreshToken(req);
    if (!refreshToken) {
      res.status(401).json({
        error: {
          code: "UNAUTHORIZED",
          message: "Refresh token required",
        },
      });
      return;
    }
    const result = await authService.refreshSession(refreshToken);
    authService.setAuthCookies(res, result.accessToken, result.refreshToken);
    res.status(200).json({
      data: {
        user: result.user,
        accessToken: result.accessToken,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function logout(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const refresh = readRefreshToken(req);
    if (req.user) {
      await authService.logout(req.user.id, refresh);
    }
    authService.clearAuthCookies(res);
    res.status(200).json({ data: { ok: true } });
  } catch (err) {
    next(err);
  }
}

export async function me(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = await authService.getCurrentUser(req.user!.id);
    res.status(200).json({ data: { user } });
  } catch (err) {
    next(err);
  }
}
