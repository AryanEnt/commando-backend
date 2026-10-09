import type { PrismaClient } from "@prisma/client";
import { forbidden } from "./errors.js";

/**
 * After a Commando hands a Sales Executive back to the Team Lead, the Commando
 * keeps read-only access for this many calendar months from the handoff date
 * (`CommandoAssignment.endedAt`). Writes always require an ACTIVE assignment.
 */
export const COMMANDO_POST_HANDOFF_VIEW_MONTHS = 1;

const DAY_MS = 24 * 60 * 60 * 1000;

function addCalendarMonths(date: Date, months: number): Date {
  const d = new Date(date);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return d;
}

export function commandoViewUntil(handedOffAt: Date): Date {
  return addCalendarMonths(handedOffAt, COMMANDO_POST_HANDOFF_VIEW_MONTHS);
}

export function isWithinCommandoViewWindow(
  handedOffAt: Date | null,
  now: Date = new Date(),
): boolean {
  if (!handedOffAt) return false;
  return commandoViewUntil(handedOffAt).getTime() > now.getTime();
}

/** Coarse DB pre-filter; callers confirm with `isWithinCommandoViewWindow`. */
function endedAfterLowerBound(now: Date): Date {
  return new Date(
    addCalendarMonths(now, -COMMANDO_POST_HANDOFF_VIEW_MONTHS).getTime() -
      3 * DAY_MS,
  );
}

type AssignmentWindowRow = {
  id: string;
  salesExecutiveProfileId: string;
  status: "ACTIVE" | "COMPLETED" | "EXITED";
  startedAt: Date;
  endedAt: Date | null;
  teamLeadUserId: string;
};

async function readableAssignments(
  prisma: PrismaClient,
  commandoUserId: string,
  profileId?: string,
  now: Date = new Date(),
): Promise<AssignmentWindowRow[]> {
  const rows = await prisma.commandoAssignment.findMany({
    where: {
      commandoUserId,
      ...(profileId ? { salesExecutiveProfileId: profileId } : {}),
      OR: [
        { status: "ACTIVE" },
        {
          status: { in: ["COMPLETED", "EXITED"] },
          endedAt: { gte: endedAfterLowerBound(now) },
        },
      ],
    },
    select: {
      id: true,
      salesExecutiveProfileId: true,
      status: true,
      startedAt: true,
      endedAt: true,
      teamLeadUserId: true,
    },
    orderBy: [{ startedAt: "desc" }],
  });
  return rows.filter(
    (r) => r.status === "ACTIVE" || isWithinCommandoViewWindow(r.endedAt, now),
  );
}

/** Profiles a Commando may READ: active assignments plus recent handoffs. */
export async function commandoReadableProfileIds(
  prisma: PrismaClient,
  commandoUserId: string,
): Promise<string[]> {
  const rows = await readableAssignments(prisma, commandoUserId);
  return [...new Set(rows.map((r) => r.salesExecutiveProfileId))];
}

/** Profiles a Commando may WRITE to: ACTIVE assignments only. */
export async function commandoWritableProfileIds(
  prisma: PrismaClient,
  commandoUserId: string,
): Promise<string[]> {
  const rows = await prisma.commandoAssignment.findMany({
    where: { commandoUserId, status: "ACTIVE" },
    select: { salesExecutiveProfileId: true },
  });
  return [...new Set(rows.map((r) => r.salesExecutiveProfileId))];
}

/** Assignment IDs (active or recently handed off) a Commando may read. */
export async function commandoReadableAssignmentIds(
  prisma: PrismaClient,
  commandoUserId: string,
): Promise<string[]> {
  const rows = await readableAssignments(prisma, commandoUserId);
  return rows.map((r) => r.id);
}

export type CommandoAccess =
  | { mode: "FULL" }
  | {
      mode: "READ_ONLY";
      handedOffAt: Date;
      until: Date;
      daysLeft: number;
      teamLeadUserId: string;
    }
  | { mode: "NONE" };

export async function getCommandoAccess(
  prisma: PrismaClient,
  commandoUserId: string,
  profileId: string,
  now: Date = new Date(),
): Promise<CommandoAccess> {
  const rows = await readableAssignments(prisma, commandoUserId, profileId, now);
  if (rows.some((r) => r.status === "ACTIVE")) return { mode: "FULL" };
  const latest = rows
    .filter((r) => r.endedAt)
    .sort((a, b) => b.endedAt!.getTime() - a.endedAt!.getTime())[0];
  if (!latest?.endedAt) return { mode: "NONE" };
  const until = commandoViewUntil(latest.endedAt);
  return {
    mode: "READ_ONLY",
    handedOffAt: latest.endedAt,
    until,
    daysLeft: Math.max(1, Math.ceil((until.getTime() - now.getTime()) / DAY_MS)),
    teamLeadUserId: latest.teamLeadUserId,
  };
}

export async function commandoCanReadProfile(
  prisma: PrismaClient,
  commandoUserId: string,
  profileId: string | null | undefined,
): Promise<boolean> {
  if (!profileId) return false;
  const access = await getCommandoAccess(prisma, commandoUserId, profileId);
  return access.mode !== "NONE";
}

/** Throws a clear message when a Commando tries to change a handed-off SE. */
export async function assertCommandoCanWriteProfile(
  prisma: PrismaClient,
  commandoUserId: string,
  profileId: string,
): Promise<void> {
  const access = await getCommandoAccess(prisma, commandoUserId, profileId);
  if (access.mode === "FULL") return;
  if (access.mode === "READ_ONLY") {
    throw forbidden(
      "View-only: this Sales Executive was handed off to the Team Lead. You can view their records but not add, edit, or delete.",
    );
  }
  throw forbidden("Record is outside your assignment scope");
}
