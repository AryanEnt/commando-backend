export const ROLE_CODES = [
  "SUPER_ADMIN",
  "TEAM_LEAD",
  "COMMANDO_EXECUTIVE",
  "SALES_EXECUTIVE",
  "SALES_SUPPORT_EXECUTIVE",
] as const;

export type RoleCode = (typeof ROLE_CODES)[number];

/** Canonical permission codes — seed and authorize against these. */
export const PERMISSIONS = {
  USER_VIEW: "USER_VIEW",
  USER_MANAGE: "USER_MANAGE",
  USER_CREATE: "USER_CREATE",
  USER_UPDATE: "USER_UPDATE",
  USER_ROLE_UPDATE: "USER_ROLE_UPDATE",
  USER_STATUS_UPDATE: "USER_STATUS_UPDATE",
  SALES_EXECUTIVE_CREATE: "SALES_EXECUTIVE_CREATE",
  SALES_SUPPORT_CREATE: "SALES_SUPPORT_CREATE",
  ROLE_VIEW: "ROLE_VIEW",
  PERMISSION_VIEW: "PERMISSION_VIEW",

  TEAM_VIEW: "TEAM_VIEW",
  TEAM_MANAGE: "TEAM_MANAGE",

  PROFILE_VIEW: "PROFILE_VIEW",
  PROFILE_MANAGE: "PROFILE_MANAGE",

  ASSIGNMENT_VIEW: "ASSIGNMENT_VIEW",
  ASSIGNMENT_CREATE: "ASSIGNMENT_CREATE",
  ASSIGNMENT_UPDATE: "ASSIGNMENT_UPDATE",

  REFERRAL_CREATE: "REFERRAL_CREATE",
  REFERRAL_VIEW: "REFERRAL_VIEW",
  REFERRAL_ACKNOWLEDGE: "REFERRAL_ACKNOWLEDGE",
  REFERRAL_UPDATE_STATUS: "REFERRAL_UPDATE_STATUS",

  SWOT_CREATE: "SWOT_CREATE",
  SWOT_VIEW: "SWOT_VIEW",

  DAILY_LOG_CREATE: "DAILY_LOG_CREATE",
  DAILY_LOG_VIEW: "DAILY_LOG_VIEW",
  ACTIVITY_TYPE_MANAGE: "ACTIVITY_TYPE_MANAGE",

  /** Executive self-reported daily work (SE + SSE). Separate from Commando Daily Logs. */
  DAILY_WORK_LOG_CREATE: "DAILY_WORK_LOG_CREATE",
  DAILY_WORK_LOG_VIEW: "DAILY_WORK_LOG_VIEW",

  WEEKLY_REVIEW_CREATE: "WEEKLY_REVIEW_CREATE",
  WEEKLY_REVIEW_EDIT: "WEEKLY_REVIEW_EDIT",
  WEEKLY_REVIEW_SUBMIT: "WEEKLY_REVIEW_SUBMIT",
  WEEKLY_REVIEW_VIEW: "WEEKLY_REVIEW_VIEW",

  MONITORING_CREATE: "MONITORING_CREATE",
  MONITORING_VIEW: "MONITORING_VIEW",
  MONITORING_CHECKLIST_MANAGE: "MONITORING_CHECKLIST_MANAGE",

  SYNC_EVAL_CREATE: "SYNC_EVAL_CREATE",
  SYNC_EVAL_VIEW: "SYNC_EVAL_VIEW",

  SALES_SUPPORT_TASK_CREATE: "SALES_SUPPORT_TASK_CREATE",
  SALES_SUPPORT_TASK_VIEW: "SALES_SUPPORT_TASK_VIEW",
  SALES_SUPPORT_TASK_UPDATE: "SALES_SUPPORT_TASK_UPDATE",
  SALES_SUPPORT_TASK_STATUS_UPDATE: "SALES_SUPPORT_TASK_STATUS_UPDATE",

  SALES_SUPPORT_LINK_VIEW: "SALES_SUPPORT_LINK_VIEW",
  SALES_SUPPORT_LINK_ASSIGN: "SALES_SUPPORT_LINK_ASSIGN",

  EISENHOWER_CREATE: "EISENHOWER_CREATE",
  EISENHOWER_UPDATE: "EISENHOWER_UPDATE",
  EISENHOWER_VIEW: "EISENHOWER_VIEW",

  ACTION_ITEM_CREATE: "ACTION_ITEM_CREATE",
  ACTION_ITEM_UPDATE: "ACTION_ITEM_UPDATE",
  ACTION_ITEM_VIEW: "ACTION_ITEM_VIEW",

  FEEDBACK_CREATE: "FEEDBACK_CREATE",
  FEEDBACK_VIEW: "FEEDBACK_VIEW",

  PERFORMANCE_CREATE: "PERFORMANCE_CREATE",
  PERFORMANCE_VIEW: "PERFORMANCE_VIEW",

  REPORT_VIEW: "REPORT_VIEW",
  DASHBOARD_VIEW: "DASHBOARD_VIEW",
  AUDIT_VIEW: "AUDIT_VIEW",
} as const;

export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSION_CODES = Object.values(PERMISSIONS);

export const PERMISSION_META: Record<
  PermissionCode,
  { name: string; description: string }
> = {
  USER_VIEW: { name: "View users", description: "List and view user accounts" },
  USER_MANAGE: {
    name: "Manage users",
    description: "Legacy umbrella for user administration",
  },
  USER_CREATE: {
    name: "Create users",
    description: "Create user accounts",
  },
  USER_UPDATE: {
    name: "Update users",
    description: "Update user account details",
  },
  USER_ROLE_UPDATE: {
    name: "Update user roles",
    description: "Change a user's system role",
  },
  USER_STATUS_UPDATE: {
    name: "Update user status",
    description: "Activate or deactivate user accounts",
  },
  SALES_EXECUTIVE_CREATE: {
    name: "Create Sales Executives",
    description: "Onboard Sales Executive accounts with team and profile",
  },
  SALES_SUPPORT_CREATE: {
    name: "Create Sales Support",
    description:
      "Create Sales Support Executive accounts and place them on a team",
  },
  ROLE_VIEW: { name: "View roles", description: "View roles and mappings" },
  PERMISSION_VIEW: {
    name: "View permissions",
    description: "View permission catalog",
  },
  TEAM_VIEW: { name: "View teams", description: "View teams in scope" },
  TEAM_MANAGE: { name: "Manage teams", description: "Create and update teams" },
  PROFILE_VIEW: {
    name: "View profiles",
    description: "View sales executive profiles in scope",
  },
  PROFILE_MANAGE: {
    name: "Manage profiles",
    description: "Create and update sales executive profiles",
  },
  ASSIGNMENT_VIEW: {
    name: "View assignments",
    description: "View Commando assignments in scope",
  },
  ASSIGNMENT_CREATE: {
    name: "Create assignments",
    description: "Create Commando assignments",
  },
  ASSIGNMENT_UPDATE: {
    name: "Update assignments",
    description: "End or update Commando assignments",
  },
  REFERRAL_CREATE: {
    name: "Create referrals",
    description: "Submit Commando referrals",
  },
  REFERRAL_VIEW: {
    name: "View referrals",
    description: "View referrals in scope",
  },
  REFERRAL_ACKNOWLEDGE: {
    name: "Acknowledge referrals",
    description: "Acknowledge received referrals",
  },
  REFERRAL_UPDATE_STATUS: {
    name: "Update referral status",
    description: "Advance referral lifecycle status",
  },
  SWOT_CREATE: { name: "Create SWOT", description: "Create SWOT analyses" },
  SWOT_VIEW: { name: "View SWOT", description: "View SWOT analyses in scope" },
  DAILY_LOG_CREATE: {
    name: "Create daily logs",
    description: "Create coaching daily logs",
  },
  DAILY_LOG_VIEW: {
    name: "View daily logs",
    description: "View daily logs in scope",
  },
  ACTIVITY_TYPE_MANAGE: {
    name: "Manage activity types",
    description: "Configure daily log activity types",
  },
  DAILY_WORK_LOG_CREATE: {
    name: "Create daily work logs",
    description: "Record own daily work as SE or SSE",
  },
  DAILY_WORK_LOG_VIEW: {
    name: "View daily work logs",
    description: "View executive daily work logs in scope",
  },
  WEEKLY_REVIEW_CREATE: {
    name: "Create weekly reviews",
    description: "Create weekly review meetings",
  },
  WEEKLY_REVIEW_EDIT: {
    name: "Edit weekly reviews",
    description: "Edit draft weekly reviews",
  },
  WEEKLY_REVIEW_SUBMIT: {
    name: "Submit weekly reviews",
    description: "Submit weekly reviews",
  },
  WEEKLY_REVIEW_VIEW: {
    name: "View weekly reviews",
    description: "View weekly reviews in scope",
  },
  MONITORING_CREATE: {
    name: "Create monitoring",
    description: "Create live monitoring records",
  },
  MONITORING_VIEW: {
    name: "View monitoring",
    description: "View monitoring records in scope",
  },
  MONITORING_CHECKLIST_MANAGE: {
    name: "Manage monitoring checklists",
    description: "Configure monitoring categories and checklist items",
  },
  SYNC_EVAL_CREATE: {
    name: "Create sync evaluations",
    description: "Create sales support sync evaluations",
  },
  SYNC_EVAL_VIEW: {
    name: "View sync evaluations",
    description: "View sync evaluations in scope",
  },
  SALES_SUPPORT_TASK_CREATE: {
    name: "Create support tasks",
    description: "Create and assign Sales Support Executive tasks",
  },
  SALES_SUPPORT_TASK_VIEW: {
    name: "View support tasks",
    description: "View Sales Support tasks in scope",
  },
  SALES_SUPPORT_TASK_UPDATE: {
    name: "Update support tasks",
    description: "Edit Commando-assigned support task definitions",
  },
  SALES_SUPPORT_TASK_STATUS_UPDATE: {
    name: "Update support task status",
    description: "Update status/progress on assigned Sales Support tasks",
  },
  SALES_SUPPORT_LINK_VIEW: {
    name: "View sales support links",
    description: "View Sales Executive ↔ Sales Support team assignments in scope",
  },
  SALES_SUPPORT_LINK_ASSIGN: {
    name: "Assign sales support links",
    description: "Assign or end Sales Support team links for Sales Executives",
  },
  EISENHOWER_CREATE: {
    name: "Create Eisenhower tasks",
    description: "Create Eisenhower matrix tasks",
  },
  EISENHOWER_UPDATE: {
    name: "Update Eisenhower tasks",
    description: "Edit Eisenhower tasks and update status",
  },
  EISENHOWER_VIEW: {
    name: "View Eisenhower tasks",
    description: "View Eisenhower tasks in scope",
  },
  ACTION_ITEM_CREATE: {
    name: "Create action items",
    description: "Create action items",
  },
  ACTION_ITEM_UPDATE: {
    name: "Update action items",
    description: "Update action item lifecycle",
  },
  ACTION_ITEM_VIEW: {
    name: "View action items",
    description: "View action items in scope",
  },
  FEEDBACK_CREATE: { name: "Create feedback", description: "Create feedback" },
  FEEDBACK_VIEW: {
    name: "View feedback",
    description: "View feedback in scope (lifecycle filtered)",
  },
  PERFORMANCE_CREATE: {
    name: "Create performance",
    description: "Create performance evaluations",
  },
  PERFORMANCE_VIEW: {
    name: "View performance",
    description: "View performance in scope (lifecycle filtered)",
  },
  REPORT_VIEW: { name: "View reports", description: "View reporting modules" },
  DASHBOARD_VIEW: {
    name: "View dashboard",
    description: "View role dashboard",
  },
  AUDIT_VIEW: { name: "View audit logs", description: "View audit trail" },
};

/** Least-privilege role → permission mapping. */
export const ROLE_PERMISSION_MAP: Record<RoleCode, PermissionCode[]> = {
  SUPER_ADMIN: [...ALL_PERMISSION_CODES],

  TEAM_LEAD: [
    PERMISSIONS.TEAM_VIEW,
    PERMISSIONS.PROFILE_VIEW,
    PERMISSIONS.SALES_EXECUTIVE_CREATE,
    PERMISSIONS.SALES_SUPPORT_CREATE,
    PERMISSIONS.ASSIGNMENT_VIEW,
    PERMISSIONS.REFERRAL_VIEW,
    PERMISSIONS.SWOT_CREATE,
    PERMISSIONS.SWOT_VIEW,
    PERMISSIONS.DAILY_LOG_CREATE,
    PERMISSIONS.DAILY_LOG_VIEW,
    PERMISSIONS.DAILY_WORK_LOG_VIEW,
    PERMISSIONS.WEEKLY_REVIEW_CREATE,
    PERMISSIONS.WEEKLY_REVIEW_EDIT,
    PERMISSIONS.WEEKLY_REVIEW_SUBMIT,
    PERMISSIONS.WEEKLY_REVIEW_VIEW,
    PERMISSIONS.MONITORING_CREATE,
    PERMISSIONS.MONITORING_VIEW,
    PERMISSIONS.SYNC_EVAL_VIEW,
    PERMISSIONS.FEEDBACK_CREATE,
    PERMISSIONS.FEEDBACK_VIEW,
    PERMISSIONS.PERFORMANCE_CREATE,
    PERMISSIONS.PERFORMANCE_VIEW,
    PERMISSIONS.ACTION_ITEM_CREATE,
    PERMISSIONS.ACTION_ITEM_UPDATE,
    PERMISSIONS.ACTION_ITEM_VIEW,
    PERMISSIONS.EISENHOWER_CREATE,
    PERMISSIONS.EISENHOWER_UPDATE,
    PERMISSIONS.EISENHOWER_VIEW,
    PERMISSIONS.SALES_SUPPORT_LINK_VIEW,
    PERMISSIONS.SALES_SUPPORT_LINK_ASSIGN,
    PERMISSIONS.SALES_SUPPORT_TASK_CREATE,
    PERMISSIONS.SALES_SUPPORT_TASK_VIEW,
    PERMISSIONS.SALES_SUPPORT_TASK_UPDATE,
    PERMISSIONS.DASHBOARD_VIEW,
  ],

  COMMANDO_EXECUTIVE: [
    PERMISSIONS.PROFILE_VIEW,
    PERMISSIONS.ASSIGNMENT_VIEW,
    PERMISSIONS.ASSIGNMENT_UPDATE,
    PERMISSIONS.REFERRAL_VIEW,
    PERMISSIONS.REFERRAL_ACKNOWLEDGE,
    PERMISSIONS.REFERRAL_UPDATE_STATUS,
    PERMISSIONS.SWOT_CREATE,
    PERMISSIONS.SWOT_VIEW,
    PERMISSIONS.DAILY_LOG_CREATE,
    PERMISSIONS.DAILY_LOG_VIEW,
    PERMISSIONS.DAILY_WORK_LOG_VIEW,
    PERMISSIONS.WEEKLY_REVIEW_CREATE,
    PERMISSIONS.WEEKLY_REVIEW_EDIT,
    PERMISSIONS.WEEKLY_REVIEW_SUBMIT,
    PERMISSIONS.WEEKLY_REVIEW_VIEW,
    PERMISSIONS.MONITORING_CREATE,
    PERMISSIONS.MONITORING_VIEW,
    PERMISSIONS.SYNC_EVAL_CREATE,
    PERMISSIONS.SYNC_EVAL_VIEW,
    PERMISSIONS.SALES_SUPPORT_TASK_CREATE,
    PERMISSIONS.SALES_SUPPORT_TASK_VIEW,
    PERMISSIONS.SALES_SUPPORT_TASK_UPDATE,
    PERMISSIONS.SALES_SUPPORT_TASK_STATUS_UPDATE,
    PERMISSIONS.SALES_SUPPORT_LINK_VIEW,
    PERMISSIONS.SALES_SUPPORT_LINK_ASSIGN,
    PERMISSIONS.EISENHOWER_CREATE,
    PERMISSIONS.EISENHOWER_UPDATE,
    PERMISSIONS.EISENHOWER_VIEW,
    PERMISSIONS.ACTION_ITEM_CREATE,
    PERMISSIONS.ACTION_ITEM_UPDATE,
    PERMISSIONS.ACTION_ITEM_VIEW,
    PERMISSIONS.FEEDBACK_CREATE,
    PERMISSIONS.FEEDBACK_VIEW,
    PERMISSIONS.PERFORMANCE_CREATE,
    PERMISSIONS.PERFORMANCE_VIEW,
    PERMISSIONS.DASHBOARD_VIEW,
  ],

  SALES_EXECUTIVE: [
    PERMISSIONS.PROFILE_VIEW,
    PERMISSIONS.ASSIGNMENT_VIEW,
    PERMISSIONS.SWOT_CREATE,
    PERMISSIONS.SWOT_VIEW,
    PERMISSIONS.WEEKLY_REVIEW_VIEW,
    PERMISSIONS.MONITORING_VIEW,
    PERMISSIONS.EISENHOWER_VIEW,
    PERMISSIONS.ACTION_ITEM_VIEW,
    PERMISSIONS.FEEDBACK_VIEW,
    PERMISSIONS.PERFORMANCE_VIEW,
    PERMISSIONS.DAILY_WORK_LOG_CREATE,
    PERMISSIONS.DAILY_WORK_LOG_VIEW,
    /** Own Support Team roster (read-only; assign remains TL-only). */
    PERMISSIONS.SALES_SUPPORT_LINK_VIEW,
    /** Own profile's support tasks (read-only). */
    PERMISSIONS.SALES_SUPPORT_TASK_VIEW,
    PERMISSIONS.DASHBOARD_VIEW,
  ],

  SALES_SUPPORT_EXECUTIVE: [
    PERMISSIONS.PROFILE_VIEW,
    PERMISSIONS.SYNC_EVAL_VIEW,
    PERMISSIONS.SALES_SUPPORT_TASK_VIEW,
    PERMISSIONS.SALES_SUPPORT_TASK_STATUS_UPDATE,
    PERMISSIONS.SALES_SUPPORT_LINK_VIEW,
    PERMISSIONS.DAILY_WORK_LOG_CREATE,
    PERMISSIONS.DAILY_WORK_LOG_VIEW,
    PERMISSIONS.SWOT_CREATE,
    PERMISSIONS.SWOT_VIEW,
    PERMISSIONS.WEEKLY_REVIEW_VIEW,
    PERMISSIONS.DASHBOARD_VIEW,
  ],
};
