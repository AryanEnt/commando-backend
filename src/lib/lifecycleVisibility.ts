import type {
  FeedbackSource,
  PerformanceSource,
  PrismaClient,
  SwotSource,
} from "@prisma/client";

export type CommandoLifecycleState = {
  hasActiveAssignment: boolean;
  hasCompletedAssignment: boolean;
  /** True while an ACTIVE Commando assignment exists. */
  isDuringCommando: boolean;
  /** True when no active assignment but at least one completed/exited cycle. */
  isAfterCommando: boolean;
};

export async function getCommandoLifecycleState(
  prisma: PrismaClient,
  profileId: string,
): Promise<CommandoLifecycleState> {
  const [active, completed] = await Promise.all([
    prisma.commandoAssignment.findFirst({
      where: { salesExecutiveProfileId: profileId, status: "ACTIVE" },
      select: { id: true },
    }),
    prisma.commandoAssignment.findFirst({
      where: {
        salesExecutiveProfileId: profileId,
        status: { in: ["COMPLETED", "EXITED"] },
      },
      select: { id: true },
    }),
  ]);

  const hasActiveAssignment = Boolean(active);
  const hasCompletedAssignment = Boolean(completed);

  return {
    hasActiveAssignment,
    hasCompletedAssignment,
    isDuringCommando: hasActiveAssignment,
    isAfterCommando: !hasActiveAssignment && hasCompletedAssignment,
  };
}

/**
 * Sales Executive visibility for SWOT sources (API-enforced).
 * During Commando: TL + self visible; Commando hidden.
 * After Commando: TL + self + Commando visible (read-only).
 */
export function salesExecutiveCanViewSwotSource(
  source: SwotSource,
  lifecycle: CommandoLifecycleState,
): boolean {
  if (source === "TEAM_LEAD" || source === "SALES_EXECUTIVE") {
    return true;
  }
  if (source === "COMMANDO") {
    return lifecycle.isAfterCommando;
  }
  return false;
}

/** SWOT sources a Sales Executive may list (SQL filter). */
export function swotSourcesVisibleToSalesExecutive(
  lifecycle: CommandoLifecycleState,
): SwotSource[] {
  const sources: SwotSource[] = ["TEAM_LEAD", "SALES_EXECUTIVE"];
  if (lifecycle.isAfterCommando) sources.push("COMMANDO");
  return sources;
}

/**
 * Live monitoring is Commando-authored.
 * Visible to the Sales Executive during and after the assignment (read-only for SE).
 */
export function salesExecutiveCanViewMonitoring(
  lifecycle: CommandoLifecycleState,
): boolean {
  return lifecycle.isDuringCommando || lifecycle.isAfterCommando;
}

/**
 * Feedback / performance source visibility for Sales Executives.
 * TEAM_LEAD always visible; COMMANDO visible during and after intervention.
 */
export function salesExecutiveCanViewCoachingSource(
  source: FeedbackSource | PerformanceSource,
  lifecycle: CommandoLifecycleState,
): boolean {
  if (source === "TEAM_LEAD") return true;
  if (source === "COMMANDO") {
    return lifecycle.isDuringCommando || lifecycle.isAfterCommando;
  }
  return false;
}

/** Coaching sources a Sales Executive may list (SQL filter). */
export function coachingSourcesVisibleToSalesExecutive(
  lifecycle: CommandoLifecycleState,
): Array<"TEAM_LEAD" | "COMMANDO"> {
  const sources: Array<"TEAM_LEAD" | "COMMANDO"> = ["TEAM_LEAD"];
  if (lifecycle.isDuringCommando || lifecycle.isAfterCommando) {
    sources.push("COMMANDO");
  }
  return sources;
}

/**
 * Action items for Sales Executives.
 * During Commando: ACTIVE (current) only.
 * After Commando: ACTIVE + history.
 */
export function salesExecutiveCanViewActionItemStatus(
  status: string,
  lifecycle: CommandoLifecycleState,
): boolean {
  if (status === "ACTIVE") return true;
  if (lifecycle.isAfterCommando) {
    return (
      status === "COMPLETED" ||
      status === "EXPIRED" ||
      status === "REPLACED" ||
      status === "CANCELLED"
    );
  }
  return false;
}

/**
 * Eisenhower for Sales Executives.
 * During Commando: current month only.
 * After Commando: historical months allowed.
 */
export function salesExecutiveCanViewEisenhowerMonth(
  monthStart: Date,
  currentMonthStart: Date,
  lifecycle: CommandoLifecycleState,
): boolean {
  if (lifecycle.isAfterCommando) return true;
  return monthStart.getTime() === currentMonthStart.getTime();
}

/**
 * Who may see Commando-sourced performance (including metrics).
 * Team Leads never see Commando performance.
 * Sales Executives only after Commando.
 * Commandos and Super Admins may see within their other scope checks.
 */
export function roleCanViewCommandoPerformance(
  roleCode: string,
  lifecycle: CommandoLifecycleState,
): boolean {
  if (roleCode === "TEAM_LEAD") return false;
  if (roleCode === "SALES_EXECUTIVE") return lifecycle.isAfterCommando;
  if (roleCode === "COMMANDO_EXECUTIVE" || roleCode === "SUPER_ADMIN") {
    return true;
  }
  return false;
}
