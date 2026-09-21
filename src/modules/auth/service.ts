import type { Response } from "express";
import { prisma } from "../../lib/prisma.js";
import { unauthorized } from "../../lib/errors.js";
import { verifyPassword } from "../../lib/password.js";
import {
  generateRefreshToken,
  hashToken,
  refreshExpiryDate,
  signAccessToken,
} from "../../lib/tokens.js";
import type { PermissionCode, RoleCode } from "../../lib/permissions.js";
import type { LoginInput } from "./schemas.js";
import { env } from "../../config/env.js";
import { ACCESS_COOKIE } from "../../middleware/auth.js";
import type { AuthUser } from "../../types/auth.js";

const REFRESH_COOKIE = "refresh_token";

function toAuthUser(user: {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  roleId: string;
  role: {
    code: string;
    rolePermissions: { permission: { code: string } }[];
  };
}): AuthUser {
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

export async function login(input: LoginInput) {
  const user = await prisma.user.findFirst({
    where: {
      email: input.email.toLowerCase(),
      deletedAt: null,
    },
    include: {
      role: {
        include: {
          rolePermissions: { include: { permission: true } },
        },
      },
    },
  });

  if (!user || !user.isActive) {
    throw unauthorized("Invalid email or password");
  }

  const valid = await verifyPassword(input.password, user.passwordHash);
  if (!valid) {
    throw unauthorized("Invalid email or password");
  }

  const authUser = toAuthUser(user);
  const accessToken = signAccessToken({
    sub: user.id,
    email: user.email,
    roleCode: authUser.roleCode,
  });

  const refreshToken = generateRefreshToken();
  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      expiresAt: refreshExpiryDate(),
    },
  });

  await prisma.auditLog.create({
    data: {
      actorId: user.id,
      action: "AUTH_LOGIN",
      entityType: "User",
      entityId: user.id,
    },
  });

  return { user: authUser, accessToken, refreshToken };
}

export async function logout(userId: string, refreshToken?: string) {
  if (refreshToken) {
    await prisma.refreshToken.updateMany({
      where: {
        userId,
        tokenHash: hashToken(refreshToken),
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
  } else {
    await prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  await prisma.auditLog.create({
    data: {
      actorId: userId,
      action: "AUTH_LOGOUT",
      entityType: "User",
      entityId: userId,
    },
  });
}

/**
 * Exchange a valid refresh token for a new access token (and rotated refresh).
 * Old refresh token is revoked (rotation) to limit replay.
 */
export async function refreshSession(refreshToken: string) {
  if (!refreshToken) {
    throw unauthorized("Refresh token required");
  }

  const tokenHash = hashToken(refreshToken);
  const stored = await prisma.refreshToken.findFirst({
    where: {
      tokenHash,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    include: {
      user: {
        include: {
          role: {
            include: {
              rolePermissions: { include: { permission: true } },
            },
          },
        },
      },
    },
  });

  if (!stored || !stored.user.isActive || stored.user.deletedAt) {
    throw unauthorized("Invalid or expired refresh token");
  }

  await prisma.refreshToken.update({
    where: { id: stored.id },
    data: { revokedAt: new Date() },
  });

  const authUser = toAuthUser(stored.user);
  const accessToken = signAccessToken({
    sub: stored.user.id,
    email: stored.user.email,
    roleCode: authUser.roleCode,
  });

  const nextRefresh = generateRefreshToken();
  await prisma.refreshToken.create({
    data: {
      userId: stored.user.id,
      tokenHash: hashToken(nextRefresh),
      expiresAt: refreshExpiryDate(),
    },
  });

  return { user: authUser, accessToken, refreshToken: nextRefresh };
}

export async function getCurrentUser(userId: string): Promise<AuthUser> {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null, isActive: true },
    include: {
      role: {
        include: {
          rolePermissions: { include: { permission: true } },
        },
      },
    },
  });

  if (!user) {
    throw unauthorized("User not found or inactive");
  }

  return toAuthUser(user);
}

function cookieBase() {
  return {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: "lax" as const,
    path: "/",
  };
}

export function setAuthCookies(
  res: Response,
  accessToken: string,
  refreshToken: string,
): void {
  const common = cookieBase();
  res.cookie(ACCESS_COOKIE, accessToken, {
    ...common,
    maxAge: env.accessCookieMaxAgeMs,
  });
  res.cookie(REFRESH_COOKIE, refreshToken, {
    ...common,
    maxAge: env.refreshTokenTtlDays * 24 * 60 * 60 * 1000,
  });
}

export function clearAuthCookies(res: Response): void {
  const common = cookieBase();
  res.clearCookie(ACCESS_COOKIE, common);
  res.clearCookie(REFRESH_COOKIE, common);
}

export async function logoutFromRefreshCookie(refreshToken: string) {
  const stored = await prisma.refreshToken.findFirst({
    where: {
      tokenHash: hashToken(refreshToken),
      revokedAt: null,
    },
    select: { userId: true },
  });
  if (!stored) return;
  await logout(stored.userId, refreshToken);
}

export { REFRESH_COOKIE };
