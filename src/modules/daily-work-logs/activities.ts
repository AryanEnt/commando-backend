import { badRequest } from "../../lib/errors.js";

export type WorkSubItem = { code: string; label: string };

export type WorkActivity = {
  code: string;
  label: string;
  /** Empty when the activity has no sub item (e.g. Email to Agent). */
  subItems: WorkSubItem[];
  /** Total Amount is asked for (and required) only for these activities. */
  hasAmount?: boolean;
};

export type WorkActivityRole = "SALES_EXECUTIVE" | "SALES_SUPPORT_EXECUTIVE";

const DOCUMENT_TYPES: WorkSubItem[] = [
  { code: "EA", label: "EA" },
  { code: "ACS", label: "ACS" },
  { code: "VETASSESS", label: "Vetassess" },
  { code: "TRA", label: "TRA" },
];

const SALES_EXECUTIVE_ACTIVITIES: WorkActivity[] = [
  {
    code: "FOLLOW_UP",
    label: "Follow Up",
    subItems: [
      { code: "WHATSAPP", label: "WhatsApp" },
      { code: "FACEBOOK", label: "Facebook" },
      { code: "LINKEDIN", label: "LinkedIn" },
      { code: "TIKTOK", label: "TikTok" },
    ],
  },
  {
    code: "KRISPCALL",
    label: "KrispCall",
    subItems: [
      { code: "OUTGOING", label: "Outgoing" },
      { code: "INCOMING", label: "Incoming" },
    ],
  },
  {
    code: "PORTAL_UPLOAD",
    label: "Portal Upload",
    subItems: [
      ...DOCUMENT_TYPES,
      { code: "FOI", label: "FOI" },
      { code: "LODGEMENT", label: "Lodgement" },
      { code: "OTHERS", label: "Others" },
    ],
  },
  {
    code: "COMMENT_HANDLING",
    label: "Comment Handling",
    subItems: [...DOCUMENT_TYPES, { code: "OTHERS", label: "Others" }],
  },
  {
    code: "SOCIAL_MEDIA_POST",
    label: "Social Media Post",
    subItems: [
      { code: "FACEBOOK", label: "Facebook" },
      { code: "LINKEDIN", label: "LinkedIn" },
      { code: "TIKTOK", label: "TikTok" },
    ],
  },
  { code: "EMAIL_TO_AGENT", label: "Email to Agent", subItems: [] },
  {
    code: "BULK_SMS",
    label: "Bulk SMS",
    subItems: [
      { code: "YES", label: "Yes" },
      { code: "NO", label: "No" },
    ],
  },
  {
    code: "DAILY_COLLECTION",
    label: "Daily Collection",
    subItems: [
      { code: "IP", label: "IP" },
      { code: "FP", label: "FP" },
    ],
    hasAmount: true,
  },
];

/** Per-role activity lists. Sales Support currently mirrors Sales Executive. */
export const WORK_ACTIVITIES: Record<WorkActivityRole, WorkActivity[]> = {
  SALES_EXECUTIVE: SALES_EXECUTIVE_ACTIVITIES,
  SALES_SUPPORT_EXECUTIVE: SALES_EXECUTIVE_ACTIVITIES,
};

export function workActivitiesForRole(roleCode: string): WorkActivity[] {
  return roleCode === "SALES_SUPPORT_EXECUTIVE"
    ? WORK_ACTIVITIES.SALES_SUPPORT_EXECUTIVE
    : WORK_ACTIVITIES.SALES_EXECUTIVE;
}

const ALL_ACTIVITIES = [
  ...new Map(
    Object.values(WORK_ACTIVITIES)
      .flat()
      .map((a) => [a.code, a]),
  ).values(),
];

/** Labels for display, across every role's list. Falls back to the raw code. */
export function workActivityLabels(
  listItem: string | null,
  subItem: string | null,
): { listItemLabel: string | null; subItemLabel: string | null } {
  if (!listItem) return { listItemLabel: null, subItemLabel: null };
  const activity = ALL_ACTIVITIES.find((a) => a.code === listItem);
  const sub = subItem
    ? activity?.subItems.find((s) => s.code === subItem)
    : undefined;
  return {
    listItemLabel: activity?.label ?? listItem,
    subItemLabel: subItem ? (sub?.label ?? subItem) : null,
  };
}

export type ResolvedWorkActivity = {
  listItem: string;
  subItem: string | null;
  totalAmount: number | null;
  /** Stored in `activity` so search and older views keep working. */
  activityLabel: string;
};

/**
 * Validate an activity / sub item / amount combination against the author's
 * role config. Sub item is required exactly when the activity has sub items;
 * Total Amount is required for amount activities and rejected otherwise.
 */
export function resolveWorkActivity(
  roleCode: string,
  input: {
    listItem: string;
    subItem?: string | null;
    totalAmount?: number | null;
  },
): ResolvedWorkActivity {
  const activity = workActivitiesForRole(roleCode).find(
    (a) => a.code === input.listItem,
  );
  if (!activity) throw badRequest("Choose an activity from the list");

  let subItem: WorkSubItem | null = null;
  if (activity.subItems.length > 0) {
    if (!input.subItem) {
      throw badRequest(`Choose a sub item for ${activity.label}`);
    }
    subItem = activity.subItems.find((s) => s.code === input.subItem) ?? null;
    if (!subItem) {
      throw badRequest(`That sub item doesn't belong to ${activity.label}`);
    }
  } else if (input.subItem) {
    throw badRequest(`${activity.label} has no sub items`);
  }

  let totalAmount: number | null = null;
  if (activity.hasAmount) {
    if (input.totalAmount === undefined || input.totalAmount === null) {
      throw badRequest(`Enter the total amount for ${activity.label}`);
    }
    totalAmount = input.totalAmount;
  } else if (input.totalAmount !== undefined && input.totalAmount !== null) {
    throw badRequest(`${activity.label} doesn't take a total amount`);
  }

  return {
    listItem: activity.code,
    subItem: subItem?.code ?? null,
    totalAmount,
    activityLabel: subItem ? `${activity.label} · ${subItem.label}` : activity.label,
  };
}
