import type { Prisma } from "@prisma/client";
import type { Actor } from "../../lib/authorization.js";
import { badRequest } from "../../lib/errors.js";
import type { prisma } from "../../lib/prisma.js";
import {
  achievementFrom,
  loadSnapshotSubjects,
  type SnapshotSubjectRole,
} from "../referrals/snapshot.js";
import {
  assertAllowedEvidenceUpload,
  isOwnedHandoffReportKey,
} from "../uploads/schemas.js";
import type { z } from "zod";
import type { handoffReportSchema } from "./schemas.js";

type Db = Prisma.TransactionClient | typeof prisma;
type HandoffReportInput = z.infer<typeof handoffReportSchema>;

export type HandoffSubject = {
  userId: string;
  name: string;
  role: SnapshotSubjectRole;
};

type AssignmentForHandoff = {
  id: string;
  salesExecutiveProfileId: string;
  startedAt: Date;
  profile: { userId: string; displayName: string };
};

const ROLE_LABEL: Record<SnapshotSubjectRole, string> = {
  SALES_EXECUTIVE: "Sales Executive",
  SALES_SUPPORT_EXECUTIVE: "Sales Support Executive",
};

const toNumber = (d: Prisma.Decimal | null) => (d == null ? null : d.toNumber());

/** The SE plus every actively linked Sales Support Executive. */
export async function loadHandoffSubjects(
  db: Db,
  assignment: AssignmentForHandoff,
): Promise<HandoffSubject[]> {
  const subjects = await loadSnapshotSubjects(db, assignment);
  return subjects.map(({ userId, name, role }) => ({ userId, name, role }));
}

/** Team Lead's figures from when this intervention was handed to the Commando. */
async function loadStartingSnapshots(db: Db, assignmentId: string) {
  const rows = await db.interventionPerformanceSnapshot.findMany({
    where: { referral: { assignmentId } },
    orderBy: { createdAt: "desc" },
  });
  const byUser = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (!byUser.has(row.subjectUserId)) byUser.set(row.subjectUserId, row);
  }
  return byUser;
}

export async function loadHandoffRequirements(
  db: Db,
  assignment: AssignmentForHandoff,
  now: Date = new Date(),
) {
  const [subjects, starting] = await Promise.all([
    loadHandoffSubjects(db, assignment),
    loadStartingSnapshots(db, assignment.id),
  ]);
  return {
    period: { start: assignment.startedAt, end: now },
    subjects: subjects.map((s) => {
      const snap = starting.get(s.userId);
      return {
        ...s,
        startingSnapshot: snap
          ? {
              overallPerformance: snap.overallPerformance,
              trend: snap.trend,
              note: snap.note,
              salesAchieved: toNumber(snap.salesAchieved),
              salesTarget: toNumber(snap.salesTarget),
              achievementPct: toNumber(snap.achievementPct),
            }
          : null,
      };
    }),
  };
}

/**
 * Requires a report for the SE and every linked SSE, validates any attached
 * documents, and stores everything inside the end-assignment transaction.
 */
export async function writeHandoffReports(
  tx: Prisma.TransactionClient,
  opts: {
    actor: Actor;
    assignment: AssignmentForHandoff;
    reports: HandoffReportInput[];
    periodEnd: Date;
  },
) {
  const { actor, assignment, reports, periodEnd } = opts;
  const subjects = await loadHandoffSubjects(tx, assignment);

  const byUser = new Map<string, HandoffReportInput>();
  for (const report of reports) {
    if (byUser.has(report.subjectUserId)) {
      throw badRequest("Only one handoff report per person");
    }
    if (!subjects.some((s) => s.userId === report.subjectUserId)) {
      throw badRequest(
        "A handoff report was sent for someone who isn't linked to this Sales Executive",
      );
    }
    byUser.set(report.subjectUserId, report);
  }
  for (const s of subjects) {
    if (!byUser.has(s.userId)) {
      throw badRequest(
        `Add a performance description for ${s.name} (${ROLE_LABEL[s.role]})`,
      );
    }
  }

  const keys = new Set<string>();
  for (const report of reports) {
    for (const file of report.attachments) {
      if (!isOwnedHandoffReportKey(file.key, actor.id) || keys.has(file.key)) {
        throw badRequest("A handoff document doesn't belong to this request");
      }
      keys.add(file.key);
      try {
        assertAllowedEvidenceUpload({
          contentType: file.contentType,
          contentLength: file.size,
          fileName: file.fileName,
        });
      } catch (err) {
        throw badRequest(err instanceof Error ? err.message : "Invalid handoff document");
      }
    }
  }
  if (keys.size > 0) {
    const reused = await tx.assignmentHandoffAttachment.findFirst({
      where: { storageKey: { in: [...keys] } },
      select: { id: true },
    });
    if (reused) throw badRequest("A handoff document doesn't belong to this request");
  }

  const created: { id: string; subjectUserId: string; subjectName: string }[] = [];
  for (const s of subjects) {
    const input = byUser.get(s.userId)!;
    const row = await tx.assignmentHandoffReport.create({
      data: {
        assignmentId: assignment.id,
        subjectUserId: s.userId,
        subjectRole: s.role,
        subjectName: s.name,
        description: input.description,
        salesAchieved: input.salesAchieved ?? null,
        salesTarget: input.salesTarget ?? null,
        achievementPct: achievementFrom(input),
        periodStart: assignment.startedAt,
        periodEnd,
        createdById: actor.id,
        attachments: {
          create: input.attachments.map((file) => ({
            storageKey: file.key,
            fileName: file.fileName,
            contentType: file.contentType,
            sizeBytes: file.size,
            uploadedById: actor.id,
          })),
        },
      },
      select: { id: true, subjectUserId: true, subjectName: true },
    });
    created.push(row);
  }
  return created;
}

const reportInclude = {
  createdBy: { select: { id: true, firstName: true, lastName: true } },
  attachments: {
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      fileName: true,
      contentType: true,
      sizeBytes: true,
      createdAt: true,
    },
  },
} satisfies Prisma.AssignmentHandoffReportInclude;

type ReportRow = Prisma.AssignmentHandoffReportGetPayload<{
  include: typeof reportInclude;
}>;

function serializeReport(row: ReportRow) {
  return {
    id: row.id,
    subjectUserId: row.subjectUserId,
    subjectRole: row.subjectRole as SnapshotSubjectRole,
    subjectName: row.subjectName,
    description: row.description,
    salesAchieved: toNumber(row.salesAchieved),
    salesTarget: toNumber(row.salesTarget),
    achievementPct: toNumber(row.achievementPct),
    period: { start: row.periodStart, end: row.periodEnd },
    createdAt: row.createdAt,
    createdBy: row.createdBy,
    attachments: row.attachments,
  };
}

/** Every handoff report written about one person, newest first, with intervention context. */
export async function listSubjectHandoffReports(
  db: Db,
  subjectUserId: string,
  assignmentWhere: Prisma.CommandoAssignmentWhereInput,
) {
  const rows = await db.assignmentHandoffReport.findMany({
    where: { subjectUserId, assignment: assignmentWhere },
    orderBy: { createdAt: "desc" },
    include: {
      ...reportInclude,
      assignment: {
        select: {
          id: true,
          status: true,
          startedAt: true,
          endedAt: true,
          profile: { select: { id: true, displayName: true } },
          commando: { select: { id: true, firstName: true, lastName: true } },
        },
      },
    },
  });
  return rows.map((row) => ({
    ...serializeReport(row),
    assignment: row.assignment,
  }));
}

export async function listHandoffReports(db: Db, assignmentId: string) {
  const rows = await db.assignmentHandoffReport.findMany({
    where: { assignmentId },
    include: reportInclude,
  });
  const order = (r: ReportRow) => (r.subjectRole === "SALES_EXECUTIVE" ? 0 : 1);
  return rows
    .sort((a, b) => order(a) - order(b) || a.subjectName.localeCompare(b.subjectName))
    .map(serializeReport);
}
