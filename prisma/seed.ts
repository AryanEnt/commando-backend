import "dotenv/config";
import { PrismaClient, type RoleCode } from "@prisma/client";
import { hashPassword } from "../src/lib/password.js";
import {
  ALL_PERMISSION_CODES,
  PERMISSION_META,
  ROLE_PERMISSION_MAP,
} from "../src/lib/permissions.js";
import { distributeEvenWeights } from "../src/modules/monitoring/scoring.js";

const prisma = new PrismaClient();

const DEV_PASSWORD = "Password123!";

const ACTIVITY_TYPES: Array<{
  code: string;
  name: string;
  description: string;
}> = [
  {
    code: "COACHING_SESSION",
    name: "Coaching Session",
    description: "One-to-one coaching conversation with the Sales Executive",
  },
  {
    code: "LIVE_CALL",
    name: "Live Call Observation",
    description: "Shadowed or joined a live customer / prospect call",
  },
  {
    code: "FIELD_VISIT",
    name: "Field / Customer Visit",
    description: "On-site visit with a customer, prospect, or partner",
  },
  {
    code: "PIPELINE_REVIEW",
    name: "Pipeline Review",
    description: "Deal-by-deal pipeline hygiene and forecast conversation",
  },
  {
    code: "PRODUCT_DEMO",
    name: "Product Demo",
    description: "Product walkthrough or solution demonstration",
  },
  {
    code: "FOLLOW_UP",
    name: "Follow-up Call",
    description: "Outbound follow-up to advance a next step or close a loop",
  },
  {
    code: "DISCOVERY",
    name: "Discovery Call",
    description: "Needs assessment / qualification conversation",
  },
  {
    code: "TEAM_HUDDLE",
    name: "Team Huddle",
    description: "Stand-up, deal clinic, or team coaching huddle",
  },
  {
    code: "ACCOUNT_PLANNING",
    name: "Account Planning",
    description: "Strategic account or territory planning session",
  },
  {
    code: "SUPPORT_HANDOFF",
    name: "Support Handoff",
    description: "Coordination with Sales Support on a live request",
  },
];

const MONITORING_CATALOGS: Array<{
  code: string;
  name: string;
  description: string;
  sortOrder: number;
  items: Array<{ code: string; label: string; sortOrder: number }>;
}> = [
  {
    code: "MORNING_ROUTINE",
    name: "Morning Routine",
    description: "Start-of-day preparation before first customer touch",
    sortOrder: 1,
    items: [
      {
        code: "PLAN_REVIEWED",
        label: "Daily plan reviewed before first customer touch",
        sortOrder: 1,
      },
      {
        code: "CRM_UPDATED",
        label: "CRM / pipeline updated from prior day",
        sortOrder: 2,
      },
      {
        code: "PRIORITIES_SET",
        label: "Top 3 priorities for the day are clear",
        sortOrder: 3,
      },
      {
        code: "FOLLOW_UPS_QUEUED",
        label: "Due follow-ups and callbacks are queued",
        sortOrder: 4,
      },
      {
        code: "BLOCKERS_NOTED",
        label: "Known blockers or support needs noted",
        sortOrder: 5,
      },
    ],
  },
  {
    code: "LIVE_CALL",
    name: "Live Call",
    description: "Observed live call quality and control",
    sortOrder: 2,
    items: [
      {
        code: "OPENING_CLEAR",
        label: "Opening was clear and purpose-led",
        sortOrder: 1,
      },
      {
        code: "DISCOVERY_DEPTH",
        label: "Discovery questions uncovered real need / pain",
        sortOrder: 2,
      },
      {
        code: "VALUE_ARTICULATED",
        label: "Value / differentiation was articulated",
        sortOrder: 3,
      },
      {
        code: "OBJECTIONS_HANDLED",
        label: "Objections were acknowledged and handled",
        sortOrder: 4,
      },
      {
        code: "NEXT_STEP_SET",
        label: "A concrete next step with owner and date was set",
        sortOrder: 5,
      },
      {
        code: "CRM_NOTE_CAPTURED",
        label: "CRM note / outcome captured after the call",
        sortOrder: 6,
      },
    ],
  },
  {
    code: "PIPELINE_HYGIENE",
    name: "Pipeline Hygiene",
    description: "Deal accuracy, next actions, and stale-deal control",
    sortOrder: 3,
    items: [
      {
        code: "STAGES_CURRENT",
        label: "Deal stages match reality",
        sortOrder: 1,
      },
      {
        code: "NEXT_ACTION_DATED",
        label: "Every active deal has a dated next action",
        sortOrder: 2,
      },
      {
        code: "STALE_FLAGGED",
        label: "Stale or stuck deals are flagged",
        sortOrder: 3,
      },
      {
        code: "FORECAST_CREDIBLE",
        label: "Forecast categories look credible",
        sortOrder: 4,
      },
      {
        code: "CLOSE_DATES_REAL",
        label: "Close dates are realistic, not aspirational",
        sortOrder: 5,
      },
    ],
  },
  {
    code: "FIELD_VISIT",
    name: "Field Visit",
    description: "On-site visit standards and follow-through",
    sortOrder: 4,
    items: [
      {
        code: "AGENDA_PREPARED",
        label: "Visit agenda and objective prepared in advance",
        sortOrder: 1,
      },
      {
        code: "STAKEHOLDERS_MAPPED",
        label: "Key stakeholders identified / mapped",
        sortOrder: 2,
      },
      {
        code: "INSIGHTS_CAPTURED",
        label: "Customer insights and commitments captured",
        sortOrder: 3,
      },
      {
        code: "FOLLOW_UP_SENT",
        label: "Follow-up summary / next step sent",
        sortOrder: 4,
      },
    ],
  },
  {
    code: "END_OF_DAY",
    name: "End of Day",
    description: "Close-of-day capture and tomorrow readiness",
    sortOrder: 5,
    items: [
      {
        code: "OUTCOMES_LOGGED",
        label: "Call / visit outcomes logged in CRM",
        sortOrder: 1,
      },
      {
        code: "TOMORROW_PLAN",
        label: "Tomorrow’s plan drafted with clear priorities",
        sortOrder: 2,
      },
      {
        code: "BLOCKERS_ESCALATED",
        label: "Blockers escalated to TL / Support / Commando as needed",
        sortOrder: 3,
      },
      {
        code: "PIPELINE_TOUCHED",
        label: "Pipeline updated for deals touched today",
        sortOrder: 4,
      },
    ],
  },
];

async function upsertRolesAndPermissions() {
  for (const code of ALL_PERMISSION_CODES) {
    const meta = PERMISSION_META[code];
    await prisma.permission.upsert({
      where: { code },
      update: { name: meta.name, description: meta.description },
      create: {
        code,
        name: meta.name,
        description: meta.description,
      },
    });
  }

  const roleDefs: { code: RoleCode; name: string; description: string }[] = [
    {
      code: "SUPER_ADMIN",
      name: "Super Admin",
      description: "Platform-wide administrative authority",
    },
    {
      code: "TEAM_LEAD",
      name: "Team Lead",
      description:
        "Permanently owns Sales Executives; responds to Commando intervention requests",
    },
    {
      code: "COMMANDO_EXECUTIVE",
      name: "Commando Executive",
      description: "Coaches assigned underperforming sales executives",
    },
    {
      code: "SALES_EXECUTIVE",
      name: "Sales Executive",
      description: "Sales executive under coaching lifecycle",
    },
    {
      code: "SALES_SUPPORT_EXECUTIVE",
      name: "Sales Support Executive",
      description: "Supports sales executives; views sync evaluations",
    },
  ];

  for (const role of roleDefs) {
    await prisma.role.upsert({
      where: { code: role.code },
      update: { name: role.name, description: role.description },
      create: role,
    });
  }

  const permissions = await prisma.permission.findMany();
  const permissionByCode = new Map(permissions.map((p) => [p.code, p.id]));
  const roles = await prisma.role.findMany();

  for (const role of roles) {
    const allowed = ROLE_PERMISSION_MAP[role.code];
    const allowedSet = new Set(allowed);
    for (const permissionCode of allowed) {
      const permissionId = permissionByCode.get(permissionCode);
      if (!permissionId) continue;
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: { roleId: role.id, permissionId },
        },
        update: {},
        create: { roleId: role.id, permissionId },
      });
    }
    const existing = await prisma.rolePermission.findMany({
      where: { roleId: role.id },
      include: { permission: { select: { code: true } } },
    });
    for (const row of existing) {
      if (!allowedSet.has(row.permission.code as (typeof allowed)[number])) {
        await prisma.rolePermission.delete({
          where: {
            roleId_permissionId: {
              roleId: row.roleId,
              permissionId: row.permissionId,
            },
          },
        });
      }
    }
  }
}

/** Production-safe catalogs used by Daily Log and Live Monitoring. */
async function upsertActivityAndMonitoringCatalogs() {
  for (const type of ACTIVITY_TYPES) {
    await prisma.activityType.upsert({
      where: { code: type.code },
      update: {
        name: type.name,
        description: type.description,
        isActive: true,
        archivedAt: null,
      },
      create: {
        code: type.code,
        name: type.name,
        description: type.description,
        isActive: true,
      },
    });
  }

  for (const catalog of MONITORING_CATALOGS) {
    const category = await prisma.monitoringCategory.upsert({
      where: { code: catalog.code },
      update: {
        name: catalog.name,
        description: catalog.description,
        sortOrder: catalog.sortOrder,
        isActive: true,
        archivedAt: null,
      },
      create: {
        code: catalog.code,
        name: catalog.name,
        description: catalog.description,
        sortOrder: catalog.sortOrder,
        isActive: true,
      },
    });

    const weights = distributeEvenWeights(catalog.items.length);
    for (let i = 0; i < catalog.items.length; i++) {
      const item = catalog.items[i]!;
      const defaultWeight = weights[i] ?? 0;
      await prisma.monitoringChecklistItem.upsert({
        where: {
          categoryId_code: {
            categoryId: category.id,
            code: item.code,
          },
        },
        update: {
          label: item.label,
          sortOrder: item.sortOrder,
          defaultWeight,
          isActive: true,
          archivedAt: null,
        },
        create: {
          categoryId: category.id,
          code: item.code,
          label: item.label,
          sortOrder: item.sortOrder,
          defaultWeight,
          isActive: true,
        },
      });
    }
  }
}

async function upsertUser(input: {
  email: string;
  firstName: string;
  lastName: string;
  roleCode: RoleCode;
}) {
  const role = await prisma.role.findUniqueOrThrow({
    where: { code: input.roleCode },
  });
  const passwordHash = await hashPassword(DEV_PASSWORD);

  return prisma.user.upsert({
    where: { email: input.email },
    update: {
      firstName: input.firstName,
      lastName: input.lastName,
      roleId: role.id,
      passwordHash,
      isActive: true,
      deletedAt: null,
    },
    create: {
      email: input.email,
      firstName: input.firstName,
      lastName: input.lastName,
      roleId: role.id,
      passwordHash,
    },
  });
}

function shouldSeedDemoUsers(): boolean {
  if (process.env.NODE_ENV === "production") {
    if (process.env.SEED_DEMO_USERS === "true") {
      throw new Error(
        "SEED_DEMO_USERS is not allowed when NODE_ENV=production. Roles, permissions, and catalogs are still seeded.",
      );
    }
    return false;
  }
  return process.env.SEED_DEMO_USERS !== "false";
}

/**
 * Seed order:
 * 1. Roles + permissions (always)
 * 2. Activity types + monitoring checklists (always — production-safe upserts)
 * 3. Demo users (dev only)
 */
async function main() {
  await upsertRolesAndPermissions();
  await upsertActivityAndMonitoringCatalogs();

  const seedDemo = shouldSeedDemoUsers();

  if (!seedDemo) {
    console.log("Seed complete.");
    console.log(
      `Roles/permissions + ${ACTIVITY_TYPES.length} activity types + ${MONITORING_CATALOGS.length} monitoring categories upserted. Demo users skipped.`,
    );
    return;
  }

  const users = [
    {
      email: "admin@commando.local",
      firstName: "Super",
      lastName: "Admin",
      roleCode: "SUPER_ADMIN" as const,
    },
  ];

  const created: Record<string, string> = {};
  for (const user of users) {
    const row = await upsertUser(user);
    created[user.roleCode] = row.email;
  }

  console.log("Seed complete.");
  console.log(
    `Activity types: ${ACTIVITY_TYPES.length}. Monitoring categories: ${MONITORING_CATALOGS.length}.`,
  );
  console.log(`Dev password for admin: ${DEV_PASSWORD}`);
  console.log(created);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
