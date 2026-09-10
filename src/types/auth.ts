import type { PermissionCode, RoleCode } from "../lib/permissions.js";

export type AuthUser = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  roleId: string;
  roleCode: RoleCode;
  permissions: PermissionCode[];
};

export {};
