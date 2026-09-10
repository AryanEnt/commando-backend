import type { NextFunction, Request, Response } from "express";
import {
  requireAuthentication as assertAuth,
  requirePermission as assertPermission,
  requireAnyPermission as assertAnyPermission,
  requireRole as assertRole,
  type Actor,
} from "../lib/authorization.js";
import type { PermissionCode, RoleCode } from "../lib/permissions.js";
import { unauthorized } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { verifyAccessToken } from "../lib/tokens.js";
import type { AuthUser } from "../types/auth.js";
import { requireRecordAccess } from "../lib/scope.js";
import type { RecordAccessContext } from "../lib/scope.js";

const ACCESS_COOKIE = "access_token";

export function getAccessTokenFromRequest(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    return header.slice("Bearer ".length).trim();
  }
  const fromParser = req.cookies?.[ACCESS_COOKIE];
  if (typeof fromParser === "string" && fromParser.length > 0) {
    return fromParser;
  }
  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    const parts = cookieHeader.split(";").map((p) => p.trim());
    for (const part of parts) {
      const [key, ...rest] = part.split("=");
      if (key === ACCESS_COOKIE) {
        return decodeURIComponent(rest.join("="));
      }
    }
  }
  return null;
}

async function loadAuthUser(userId: string): Promise<AuthUser | null> {
  const user = await prisma.user.findFirst({
    where: { id: userId, isActive: true, deletedAt: null },
    include: {
      role: {
        include: {
          rolePermissions: {
            include: { permission: true },
          },
        },
      },
    },
  });

  if (!user) return null;

  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    roleId: user.roleId,
    roleCode: user.role.code as RoleCode,
    permissions: user.role.rolePermissions.map(
      (rp) => rp.permission.code as PermissionCode,
    ),
  };
}

export async function requireAuthentication(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = getAccessTokenFromRequest(req);
    if (!token) {
      throw unauthorized();
    }
    const payload = verifyAccessToken(token);
    const user = await loadAuthUser(payload.sub);
    if (!user) {
      throw unauthorized("User not found or inactive");
    }
    req.user = user;
    next();
  } catch (err) {
    if (err && typeof err === "object" && "name" in err) {
      const name = (err as { name: string }).name;
      if (name === "JsonWebTokenError" || name === "TokenExpiredError") {
        next(unauthorized("Invalid or expired token"));
        return;
      }
    }
    next(err);
  }
}

export function requirePermission(
  permission: PermissionCode | PermissionCode[],
) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      assertPermission(req.user as Actor | undefined, permission);
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function requireAnyPermission(permissions: PermissionCode[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      assertAnyPermission(req.user as Actor | undefined, permissions);
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function requireRole(roles: RoleCode | RoleCode[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      assertRole(req.user as Actor | undefined, roles);
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function requireRecordAccessMiddleware(
  resolveContext: (
    req: Request,
  ) => Promise<RecordAccessContext> | RecordAccessContext,
) {
  return async (
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      assertAuth(req.user as Actor | undefined);
      const context = await resolveContext(req);
      await requireRecordAccess(prisma, req.user as Actor, context);
      next();
    } catch (err) {
      next(err);
    }
  };
}

export { ACCESS_COOKIE };
