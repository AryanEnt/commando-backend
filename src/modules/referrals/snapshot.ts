import type { Prisma } from "@prisma/client";
import type { Actor } from "../../lib/authorization.js";
import { badRequest } from "../../lib/errors.js";
import type { prisma } from "../../lib/prisma.js";
import {
  assertAllowedEvidenceUpload,
  isOwnedInterventionEvidenceKey,
} from "../uploads/schemas.js";
import type { PerformanceSnapshotInput } from "./schemas.js";

type Db = Prisma.TransactionClient | typeof prisma;

export const SNAPSHOT_PERIOD_MONTHS = 6;

export type SnapshotPeriodKind = "SIX_MONTHS" | "ALL_HISTORY";

export type SnapshotPeriod = {
  kind: SnapshotPeriodKind;
  start: Date;
  end: Date;
};

/** Past 6 months, or all available history when active for less than that. */
export function snapshotPeriod(activeSince: Date, now: Date = new Date()): SnapshotPeriod {
  const windowStart = new Date(now);
  windowStart.setMonth(windowStart.getMonth() - SNAPSHOT_PERIOD_MONTHS);
  return activeSince <= windowStart
    ? { kind: "SIX_MONTHS", start: windowStart, end: now }
    : { kind: "ALL_HISTORY", start: activeSince, end: now };
}

export type SnapshotSubjectRole = "SALES_EXECUTIVE" | "SALES_SUPPORT_EXECUTIVE";

export type SnapshotSubject = {
  userId: string;
  name: string;
  role: SnapshotSubjectRole;
  period: SnapshotPeriod;
};

/** Earliest team membership start, falling back to account creation. */
async function activeSinceByUser(db: Db, userIds: string[]) {
  const users = await db.user.findMany({
    where: { id: { in: userIds } },
    select: {
      id: true,
      createdAt: true,
      teamMemberships: {
        select: { startedAt: true },
        orderBy: { startedAt: "asc" },
        take: 1,
      },
    },
  });
  const map = new Map<string, Date>();
  for (const u of users) {
    const joined = u.teamMemberships[0]?.startedAt;
    map.set(u.id, joined && joined < u.createdAt ? joined : u.createdAt);
  }
  return map;
}

/** The SE plus every actively linked Sales Support Executive. */
export async function loadSnapshotSubjects(
  db: Db,
  referral: {
    salesExecutiveProfileId: string;
    profile: { userId: string; displayName: string };
  },
  now: Date = new Date(),
): Promise<SnapshotSubject[]> {
  const links = await db.salesSupportLink.findMany({
    where: {
      salesExecutiveProfileId: referral.salesExecutiveProfileId,
      isActive: true,
      supportUser: { deletedAt: null, isActive: true },
    },
    orderBy: { startedAt: "asc" },
    select: {
      supportUser: { select: { id: true, firstName: true, lastName: true } },
    },
  });
  const supports = new Map<string, string>();
  for (const link of links) {
    const u = link.supportUser;
    if (u.id !== referral.profile.userId && !supports.has(u.id)) {
      supports.set(u.id, `${u.firstName} ${u.lastName}`.trim());
    }
  }

  const since = await activeSinceByUser(db, [
    referral.profile.userId,
    ...supports.keys(),
  ]);
  const periodFor = (id: string) => snapshotPeriod(since.get(id) ?? now, now);

  return [
    {
      userId: referral.profile.userId,
      name: referral.profile.displayName,
      role: "SALES_EXECUTIVE",
      period: periodFor(referral.profile.userId),
    },
    ...[...supports].map(([userId, name]) => ({
      userId,
      name,
      role: "SALES_SUPPORT_EXECUTIVE" as const,
      period: periodFor(userId),
    })),
  ];
}

export function achievementFrom(input: {
  salesAchieved?: number | null;
  salesTarget?: number | null;
  achievementPct?: number | null;
}): number | null {
  if (input.salesAchieved != null && input.salesTarget) {
    return Math.round((input.salesAchieved / input.salesTarget) * 10000) / 100;
  }
  return input.achievementPct ?? null;
}

const snapshotInclude = {
  createdBy: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.InterventionPerformanceSnapshotInclude;

type SnapshotRow = Prisma.InterventionPerformanceSnapshotGetPayload<{
  include: typeof snapshotInclude;
}>;

type EvidenceRow = {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number | null;
  createdAt: Date;
};

const toNumber = (d: Prisma.Decimal | null) => (d == null ? null : d.toNumber());

function monthlySalesFromJson(value: Prisma.JsonValue | null) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error("Invalid monthly sales data in performance snapshot");
  return value.map((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new Error("Invalid monthly sales entry in performance snapshot");
    }
    const month = entry.month;
    const salesAchieved = entry.salesAchieved;
    if (
      typeof month !== "string" ||
      !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) ||
      typeof salesAchieved !== "number" ||
      !Number.isFinite(salesAchieved) ||
      salesAchieved < 0
    ) {
      throw new Error("Invalid monthly sales entry in performance snapshot");
    }
    return { month, salesAchieved };
  });
}

export function serializeSnapshot(row: SnapshotRow) {
  return {
    id: row.id,
    subjectUserId: row.subjectUserId,
    subjectRole: row.subjectRole as SnapshotSubjectRole,
    subjectName: row.subjectName,
    overallPerformance: row.overallPerformance,
    trend: row.trend,
    insights: row.insights,
    note: row.note,
    salesAchieved: toNumber(row.salesAchieved),
    salesTarget: toNumber(row.salesTarget),
    achievementPct: toNumber(row.achievementPct),
    monthlySales: monthlySalesFromJson(row.monthlySales),
    period: {
      kind: row.periodKind as SnapshotPeriodKind,
      start: row.periodStart,
      end: row.periodEnd,
    },
    createdAt: row.createdAt,
    createdBy: row.createdBy,
  };
}

export function serializeEvidence(row: EvidenceRow) {
  return {
    id: row.id,
    fileName: row.fileName,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    createdAt: row.createdAt,
  };
}

export async function loadSnapshotPacket(db: Db, referralId: string) {
  const [snapshots, evidence] = await Promise.all([
    db.interventionPerformanceSnapshot.findMany({
      where: { referralId },
      include: snapshotInclude,
    }),
    db.interventionSnapshotEvidence.findMany({
      where: { referralId },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  const order = (r: SnapshotRow) => (r.subjectRole === "SALES_EXECUTIVE" ? 0 : 1);
  return {
    performanceSnapshots: snapshots
      .sort((a, b) => order(a) - order(b) || a.subjectName.localeCompare(b.subjectName))
      .map(serializeSnapshot),
    snapshotEvidence: evidence.map(serializeEvidence),
  };
}

/**
 * Validates the snapshot against the people actually linked to this
 * intervention and stores it (plus any evidence) inside the approval transaction.
 */
export async function writePerformanceSnapshot(
  tx: Prisma.TransactionClient,
  opts: {
    actor: Actor;
    referral: {
      id: string;
      salesExecutiveProfileId: string;
      profile: { userId: string; displayName: string };
    };
    input: PerformanceSnapshotInput;
    now: Date;
  },
) {
  const { actor, referral, input, now } = opts;
  const [se, ...supports] = await loadSnapshotSubjects(tx, referral, now);

  const supportInputs = new Map(input.salesSupport.map((s) => [s.subjectUserId, s]));
  for (const id of supportInputs.keys()) {
    if (!supports.some((s) => s.userId === id)) {
      throw badRequest(
        "A Sales Support snapshot was sent for someone who isn't linked to this Sales Executive",
      );
    }
  }
  for (const s of supports) {
    if (!supportInputs.has(s.userId)) {
      throw badRequest(`Complete the performance snapshot for ${s.name} (Sales Support Executive)`);
    }
  }

  const keys = new Set<string>();
  for (const file of input.evidence) {
    if (!isOwnedInterventionEvidenceKey(file.key, actor.id) || keys.has(file.key)) {
      throw badRequest("A supporting document doesn't belong to this request");
    }
    keys.add(file.key);
    try {
      assertAllowedEvidenceUpload({
        contentType: file.contentType,
        contentLength: file.size,
        fileName: file.fileName,
      });
    } catch (err) {
      throw badRequest(err instanceof Error ? err.message : "Invalid supporting document");
    }
  }
  if (keys.size > 0) {
    const reused = await tx.interventionSnapshotEvidence.findFirst({
      where: { storageKey: { in: [...keys] } },
      select: { id: true },
    });
    if (reused) throw badRequest("A supporting document doesn't belong to this request");
  }

  const rows = [
    { subject: se!, data: input.salesExecutive },
    ...supports.map((s) => ({ subject: s, data: supportInputs.get(s.userId)! })),
  ];
  for (const { subject, data } of rows) {
    const salesAchieved =
      data.monthlySales && data.monthlySales.length > 0
        ? Math.round(
            data.monthlySales.reduce((total, entry) => total + entry.salesAchieved, 0) * 100,
          ) / 100
        : data.salesAchieved ?? null;
    await tx.interventionPerformanceSnapshot.create({
      data: {
        referralId: referral.id,
        subjectUserId: subject.userId,
        subjectRole: subject.role,
        subjectName: subject.name,
        overallPerformance: data.overallPerformance,
        trend: data.trend,
        insights: data.insights,
        note: data.note,
        salesAchieved,
        salesTarget: data.salesTarget ?? null,
        achievementPct: achievementFrom({ ...data, salesAchieved }),
        monthlySales: data.monthlySales ?? [],
        periodKind: subject.period.kind,
        periodStart: subject.period.start,
        periodEnd: subject.period.end,
        createdById: actor.id,
      },
    });
  }
  if (input.evidence.length > 0) {
    await tx.interventionSnapshotEvidence.createMany({
      data: input.evidence.map((file) => ({
        referralId: referral.id,
        storageKey: file.key,
        fileName: file.fileName,
        contentType: file.contentType,
        sizeBytes: file.size,
        uploadedById: actor.id,
      })),
    });
  }

  const packet = await loadSnapshotPacket(tx, referral.id);
  return {
    ...packet,
    auditSummary: {
      salesExecutive: summarize(packet.performanceSnapshots[0]!),
      salesSupport: packet.performanceSnapshots.slice(1).map(summarize),
      evidence: packet.snapshotEvidence.map((e) => ({ id: e.id, fileName: e.fileName })),
    },
  };
}

function summarize(s: ReturnType<typeof serializeSnapshot>) {
  return {
    snapshotId: s.id,
    subjectUserId: s.subjectUserId,
    subjectName: s.subjectName,
    overallPerformance: s.overallPerformance,
    trend: s.trend,
    insights: s.insights,
    periodKind: s.period.kind,
  };
}
