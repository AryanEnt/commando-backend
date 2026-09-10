import { describe, expect, it } from "vitest";
import {
  PERMISSIONS,
  ROLE_PERMISSION_MAP,
  ALL_PERMISSION_CODES,
} from "../src/lib/permissions.js";
import {
  requireAuthentication,
  requirePermission,
  requireRole,
} from "../src/lib/authorization.js";
import { AppError } from "../src/lib/errors.js";
import type { Actor } from "../src/lib/authorization.js";

function actor(
  roleCode: Actor["roleCode"],
  permissions: Actor["permissions"],
): Actor {
  return { id: "u1", roleCode, permissions };
}

describe("permission matrix (least privilege)", () => {
  it("does not grant USER_MANAGE to non-admins", () => {
    expect(ROLE_PERMISSION_MAP.TEAM_LEAD).not.toContain(PERMISSIONS.USER_MANAGE);
    expect(ROLE_PERMISSION_MAP.COMMANDO_EXECUTIVE).not.toContain(
      PERMISSIONS.USER_MANAGE,
    );
    expect(ROLE_PERMISSION_MAP.SALES_EXECUTIVE).not.toContain(
      PERMISSIONS.USER_MANAGE,
    );
    expect(ROLE_PERMISSION_MAP.SALES_SUPPORT_EXECUTIVE).not.toContain(
      PERMISSIONS.USER_MANAGE,
    );
    expect(ROLE_PERMISSION_MAP.TEAM_LEAD).not.toContain(PERMISSIONS.USER_CREATE);
    expect(ROLE_PERMISSION_MAP.TEAM_LEAD).not.toContain(
      PERMISSIONS.SALES_EXECUTIVE_CREATE,
    );
  });

  it("limits sales support to sync eval, role assignment, support tasks, and dashboard", () => {
    expect(ROLE_PERMISSION_MAP.SALES_SUPPORT_EXECUTIVE).toEqual([
      PERMISSIONS.SYNC_EVAL_VIEW,
      PERMISSIONS.ROLE_ASSIGNMENT_VIEW,
      PERMISSIONS.SALES_SUPPORT_TASK_VIEW,
      PERMISSIONS.SALES_SUPPORT_TASK_STATUS_UPDATE,
      PERMISSIONS.DASHBOARD_VIEW,
    ]);
    expect(ROLE_PERMISSION_MAP.SALES_SUPPORT_EXECUTIVE).not.toContain(
      PERMISSIONS.SALES_SUPPORT_TASK_CREATE,
    );
    expect(ROLE_PERMISSION_MAP.SALES_SUPPORT_EXECUTIVE).not.toContain(
      PERMISSIONS.SALES_SUPPORT_TASK_UPDATE,
    );
  });

  it("does not give sales executive referral or monitoring create", () => {
    expect(ROLE_PERMISSION_MAP.SALES_EXECUTIVE).not.toContain(
      PERMISSIONS.REFERRAL_CREATE,
    );
    expect(ROLE_PERMISSION_MAP.SALES_EXECUTIVE).not.toContain(
      PERMISSIONS.MONITORING_CREATE,
    );
  });

  it("super admin receives every permission", () => {
    expect(ROLE_PERMISSION_MAP.SUPER_ADMIN).toEqual(ALL_PERMISSION_CODES);
  });
});

describe("authorization helpers", () => {
  it("requireAuthentication rejects missing user", () => {
    expect(() => requireAuthentication(null)).toThrow(AppError);
  });

  it("requirePermission allows granted permission", () => {
    const user = actor("TEAM_LEAD", [PERMISSIONS.REFERRAL_CREATE]);
    expect(requirePermission(user, PERMISSIONS.REFERRAL_CREATE)).toBe(user);
  });

  it("requirePermission rejects missing permission", () => {
    const user = actor("SALES_EXECUTIVE", [PERMISSIONS.DASHBOARD_VIEW]);
    expect(() =>
      requirePermission(user, PERMISSIONS.USER_MANAGE),
    ).toThrow(AppError);
  });

  it("requireRole allows matching role", () => {
    const user = actor("COMMANDO_EXECUTIVE", []);
    expect(requireRole(user, "COMMANDO_EXECUTIVE")).toBe(user);
  });

  it("requireRole rejects incorrect role", () => {
    const user = actor("SALES_EXECUTIVE", []);
    expect(() => requireRole(user, "SUPER_ADMIN")).toThrow(AppError);
  });
});
