import type { PrismaClient } from "@prisma/client";
import type { Actor } from "./authorization.js";
import { isSuperAdmin } from "./authorization.js";
import { forbidden } from "./errors.js";
import { AUDIT_ACTIONS, writeAuditLog } from "./audit.js";

/**
 * While a Commando intervention is ACTIVE, the Team Lead remains the permanent
 * owner but normal operational writes for that SE are paused. View access stays.
 * Enforced server-side — never rely on hiding UI alone.
 */
export async function assertTeamLeadOperationalWriteAllowed(
  prisma: PrismaClient,
  actor: Actor,
  salesExecutiveProfileId: string,
  options?: { action?: string },
): Promise<void> {
  if (isSuperAdmin(actor)) return;
  if (actor.roleCode !== "TEAM_LEAD") return;

  const active = await prisma.commandoAssignment.findFirst({
    where: {
      salesExecutiveProfileId,
      status: "ACTIVE",
    },
    select: {
      id: true,
      commandoUserId: true,
      startedAt: true,
    },
  });

  if (!active) return;

  await writeAuditLog({
    actorId: actor.id,
    action: AUDIT_ACTIONS.TEAM_LEAD_WRITE_BLOCKED_DURING_INTERVENTION,
    entityType: "CommandoAssignment",
    entityId: active.id,
    metadata: {
      profileId: salesExecutiveProfileId,
      attemptedAction: options?.action ?? "WRITE",
      verb: "LOCK",
    },
  });

  throw forbidden(
    "This Sales Executive is under an active Commando intervention. Team Lead operational work is paused until the intervention is completed or exited. You can still view the profile and history.",
  );
}

export async function getActiveInterventionForProfile(
  prisma: PrismaClient,
  salesExecutiveProfileId: string,
) {
  return prisma.commandoAssignment.findFirst({
    where: {
      salesExecutiveProfileId,
      status: "ACTIVE",
    },
    select: {
      id: true,
      status: true,
      startedAt: true,
      endedAt: true,
      commandoUserId: true,
      teamLeadUserId: true,
      commando: {
        select: { id: true, firstName: true, lastName: true, email: true },
      },
    },
  });
}
