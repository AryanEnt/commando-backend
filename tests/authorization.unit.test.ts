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
  });

  it("limits sales support to profile, sync eval, support tasks, links, and dashboard", () => {
    expect(ROLE_PERMISSION_MAP.SALES_SUPPORT_EXECUTIVE).toEqual([
      PERMISSIONS.PROFILE_VIEW,
      PERMISSIONS.SYNC_EVAL_VIEW,
      PERMISSIONS.SALES_SUPPORT_TASK_VIEW,
      PERMISSIONS.SALES_SUPPORT_TASK_STATUS_UPDATE,
      PERMISSIONS.SALES_SUPPORT_LINK_VIEW,
      PERMISSIONS.DASHBOARD_VIEW,
    ]);
    expect(ROLE_PERMISSION_MAP.SALES_SUPPORT_EXECUTIVE).not.toContain(
      PERMISSIONS.SALES_SUPPORT_TASK_CREATE,
    );
    expect(ROLE_PERMISSION_MAP.SALES_SUPPORT_EXECUTIVE).not.toContain(
      PERMISSIONS.SALES_SUPPORT_TASK_UPDATE,
    );
    expect(ROLE_PERMISSION_MAP.SALES_SUPPORT_EXECUTIVE).not.toContain(
      PERMISSIONS.SALES_SUPPORT_LINK_ASSIGN,
    );
  });

  it("grants team lead sales executive and sales support create", () => {
    expect(ROLE_PERMISSION_MAP.TEAM_LEAD).toContain(
      PERMISSIONS.SALES_EXECUTIVE_CREATE,
    );
    expect(ROLE_PERMISSION_MAP.TEAM_LEAD).toContain(
      PERMISSIONS.SALES_SUPPORT_CREATE,
    );
    expect(ROLE_PERMISSION_MAP.TEAM_LEAD).not.toContain(PERMISSIONS.USER_CREATE);
  });

  it("grants team lead support link assign and view", () => {
    expect(ROLE_PERMISSION_MAP.TEAM_LEAD).toContain(
      PERMISSIONS.SALES_SUPPORT_LINK_VIEW,
    );
    expect(ROLE_PERMISSION_MAP.TEAM_LEAD).toContain(
      PERMISSIONS.SALES_SUPPORT_LINK_ASSIGN,
    );
  });

  it("grants commando support link view and assign for active interventions", () => {
    expect(ROLE_PERMISSION_MAP.COMMANDO_EXECUTIVE).toContain(
      PERMISSIONS.SALES_SUPPORT_LINK_VIEW,
    );
    expect(ROLE_PERMISSION_MAP.COMMANDO_EXECUTIVE).toContain(
      PERMISSIONS.SALES_SUPPORT_LINK_ASSIGN,
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

  it("grants sales executive support link view for own team (not assign)", () => {
    expect(ROLE_PERMISSION_MAP.SALES_EXECUTIVE).toContain(
      PERMISSIONS.SALES_SUPPORT_LINK_VIEW,
    );
    expect(ROLE_PERMISSION_MAP.SALES_EXECUTIVE).not.toContain(
      PERMISSIONS.SALES_SUPPORT_LINK_ASSIGN,
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
