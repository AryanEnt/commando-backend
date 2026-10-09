import type { NextFunction, Request, Response } from "express";
import {
  requireAuthentication as assertAuth,
  requirePermission as assertPermission,
  requireAnyPermission as assertAnyPermission,
  requireRole as assertRole,
  type Actor,
} from "../lib/authorization.js";
import type { PermissionCode, RoleCode } from "../lib/permissions.js";
import { sessionReplaced, unauthorized } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { readThroughCache } from "../lib/readCache.js";
import { verifyAccessToken, type AccessTokenPayload } from "../lib/tokens.js";
import type { AuthUser } from "../types/auth.js";
import { requireRecordAccess } from "../lib/scope.js";
import type { RecordAccessContext } from "../lib/scope.js";

const ACCESS_COOKIE = "access_token";

function readAccessCookie(req: Request): string | null {
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

function isUsableJwt(token: string): boolean {
  try {
    verifyAccessToken(token);
    return true;
  } catch {
    return false;
  }
}

export function getAccessTokenFromRequest(req: Request): string | null {
  const header = req.headers.authorization;
  const bearer = header?.startsWith("Bearer ")
    ? header.slice("Bearer ".length).trim()
    : "";
  const cookie = readAccessCookie(req);

  if (bearer && isUsableJwt(bearer)) return bearer;
  if (cookie && isUsableJwt(cookie)) return cookie;
  return bearer || cookie || null;
}

type RoleGrant = { code: RoleCode; permissions: PermissionCode[] };

/** Role permissions only change via the seed script, so they are cached; user state is not. */
const ROLE_CACHE_TTL_MS = 5 * 60 * 1000;
const roleCache = new Map<string, { grant: RoleGrant; expiresAt: number }>();

async function loadRoleGrant(roleId: string): Promise<RoleGrant | null> {
  const cached = roleCache.get(roleId);
  if (cached && cached.expiresAt > Date.now()) return cached.grant;

  const role = await prisma.role.findUnique({
    where: { id: roleId },
    select: {
      code: true,
      rolePermissions: { select: { permission: { select: { code: true } } } },
    },
  });
  if (!role) return null;

  const grant: RoleGrant = {
    code: role.code as RoleCode,
    permissions: role.rolePermissions.map(
      (rp) => rp.permission.code as PermissionCode,
    ),
  };
  roleCache.set(roleId, { grant, expiresAt: Date.now() + ROLE_CACHE_TTL_MS });
  return grant;
}

/** Test helper — drop cached role permissions. */
export function clearRoleGrantCache(): void {
  roleCache.clear();
}

/** Throws SESSION_REPLACED when the token belongs to an older login session. */
async function loadAuthUser(
  payload: AccessTokenPayload,
): Promise<AuthUser | null> {
  const user = await prisma.user.findFirst({
    where: { id: payload.sub, isActive: true, deletedAt: null },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      roleId: true,
      tokenVersion: true,
    },
  });

  if (!user) return null;
  if ((payload.ver ?? 0) !== user.tokenVersion) throw sessionReplaced();

  const grant = await loadRoleGrant(user.roleId);
  if (!grant) return null;

  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    roleId: user.roleId,
    roleCode: grant.code,
    permissions: grant.permissions,
  };
}

/** Attaches req.user when a valid access token is present; never rejects. */
export async function optionalAuthentication(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = getAccessTokenFromRequest(req);
    if (!token || !isUsableJwt(token)) {
      next();
      return;
    }
    const user = await loadAuthUser(verifyAccessToken(token));
    if (user) req.user = user;
  } catch {
    /* stay anonymous */
  }
  next();
}

export async function requireAuthentication(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = getAccessTokenFromRequest(req);
    if (!token) {
      throw unauthorized();
    }
    const user = await loadAuthUser(verifyAccessToken(token));
    if (!user) {
      throw unauthorized("User not found or inactive");
    }
    req.user = user;
    await readThroughCache(req, res, next);
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
