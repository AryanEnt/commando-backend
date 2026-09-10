import type { RoleCode } from "../lib/permissions.js";
import type { PermissionCode } from "../lib/permissions.js";
import { forbidden, unauthorized } from "../lib/errors.js";

export type Actor = {
  id: string;
  roleCode: RoleCode;
  permissions: PermissionCode[];
};

export function requireAuthentication(user?: Actor | null): asserts user is Actor {
  if (!user) {
    throw unauthorized();
  }
}

export function requirePermission(
  user: Actor | undefined | null,
  permission: PermissionCode | PermissionCode[],
): Actor {
  requireAuthentication(user);
  const required = Array.isArray(permission) ? permission : [permission];
  const missing = required.filter((p) => !user.permissions.includes(p));
  if (missing.length > 0) {
    throw forbidden(`Missing permission: ${missing.join(", ")}`);
  }
  return user;
}

/** Pass if the actor has at least one of the listed permissions. */
export function requireAnyPermission(
  user: Actor | undefined | null,
  permissions: PermissionCode[],
): Actor {
  requireAuthentication(user);
  const ok = permissions.some((p) => user.permissions.includes(p));
  if (!ok) {
    throw forbidden(`Missing one of: ${permissions.join(", ")}`);
  }
  return user;
}

export function requireRole(
  user: Actor | undefined | null,
  roles: RoleCode | RoleCode[],
): Actor {
  requireAuthentication(user);
  const allowed = Array.isArray(roles) ? roles : [roles];
  if (!allowed.includes(user.roleCode)) {
    throw forbidden(`Role ${user.roleCode} is not allowed`);
  }
  return user;
}

export function hasPermission(
  user: Actor | undefined | null,
  permission: PermissionCode,
): boolean {
  return Boolean(user?.permissions.includes(permission));
}

export function isSuperAdmin(user: Actor): boolean {
  return user.roleCode === "SUPER_ADMIN";
}
