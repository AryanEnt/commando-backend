import "dotenv/config";
import { PrismaClient, type RoleCode } from "@prisma/client";
import { hashPassword } from "../src/lib/password.js";
import {
  ALL_PERMISSION_CODES,
  PERMISSION_META,
  ROLE_PERMISSION_MAP,
} from "../src/lib/permissions.js";

const prisma = new PrismaClient();

const DEV_PASSWORD = "Password123!";

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
      description: "Permanently owns Sales Executives; responds to Commando intervention requests",
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
    // Revoke permissions no longer mapped to this role
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
        "SEED_DEMO_USERS is not allowed when NODE_ENV=production. Catalogs (roles, permissions, activity types, monitoring checklists) are still seeded.",
      );
    }
    return false;
  }
  return process.env.SEED_DEMO_USERS !== "false";
}

async function main() {
  await upsertRolesAndPermissions();

  const seedDemo = shouldSeedDemoUsers();
  let demoSummary: Record<string, string> | null = null;

  if (seedDemo) {
  const superAdmin = await upsertUser({
    email: "admin@commando.local",
    firstName: "Super",
    lastName: "Admin",
    roleCode: "SUPER_ADMIN",
  });

  const teamLead = await upsertUser({
    email: "teamlead@commando.local",
    firstName: "Tina",
    lastName: "Lead",
    roleCode: "TEAM_LEAD",
  });

  const commando = await upsertUser({
    email: "commando@commando.local",
    firstName: "Chris",
    lastName: "Commando",
    roleCode: "COMMANDO_EXECUTIVE",
  });

  const salesExec = await upsertUser({
    email: "sales@commando.local",
    firstName: "Sam",
    lastName: "Seller",
    roleCode: "SALES_EXECUTIVE",
  });

  const salesSupport = await upsertUser({
    email: "support@commando.local",
    firstName: "Sara",
    lastName: "Support",
    roleCode: "SALES_SUPPORT_EXECUTIVE",
  });

  const team = await prisma.team.upsert({
    where: { id: "seed-team-alpha" },
    update: { name: "Alpha Sales Team", archivedAt: null },
    create: {
      id: "seed-team-alpha",
      name: "Alpha Sales Team",
      description: "Development seed team",
    },
  });

  await prisma.teamMembership.deleteMany({
    where: {
      teamId: team.id,
      userId: { in: [teamLead.id, salesExec.id, salesSupport.id] },
    },
  });

  await prisma.teamMembership.createMany({
    data: [
      {
        teamId: team.id,
        userId: teamLead.id,
        roleInTeam: "TEAM_LEAD",
        isActive: true,
      },
      {
        teamId: team.id,
        userId: salesExec.id,
        roleInTeam: "SALES_EXECUTIVE",
        isActive: true,
      },
      {
        teamId: team.id,
        userId: salesSupport.id,
        roleInTeam: "SALES_SUPPORT_EXECUTIVE",
        isActive: true,
      },
    ],
  });

  const profile = await prisma.salesExecutiveProfile.upsert({
    where: { userId: salesExec.id },
    update: {
      displayName: "Sam Seller",
      teamId: team.id,
      employeeCode: "SE-001",
      archivedAt: null,
    },
    create: {
      userId: salesExec.id,
      teamId: team.id,
      displayName: "Sam Seller",
      employeeCode: "SE-001",
    },
  });

  const existingActive = await prisma.commandoAssignment.findFirst({
    where: {
      salesExecutiveProfileId: profile.id,
      status: "ACTIVE",
    },
  });

  if (!existingActive) {
    await prisma.commandoAssignment.create({
      data: {
        salesExecutiveProfileId: profile.id,
        commandoUserId: commando.id,
        teamLeadUserId: teamLead.id,
        teamId: team.id,
        startedAt: new Date(),
        status: "ACTIVE",
      },
    });
  }

  await prisma.salesSupportLink.deleteMany({
    where: {
      salesExecutiveProfileId: profile.id,
      salesSupportUserId: salesSupport.id,
    },
  });

  await prisma.salesSupportLink.create({
    data: {
      salesExecutiveProfileId: profile.id,
      salesSupportUserId: salesSupport.id,
      isActive: true,
    },
  });

    demoSummary = {
      superAdmin: superAdmin.email,
      teamLead: teamLead.email,
      commando: commando.email,
      salesExec: salesExec.email,
      salesSupport: salesSupport.email,
      team: team.name,
      profile: profile.displayName,
    };
  }

  const activityTypes = [
    {
      code: "COACHING_SESSION",
      name: "Coaching Session",
      description: "One-to-one coaching conversation",
    },
    {
      code: "CALL_SHADOW",
      name: "Call Shadow",
      description: "Live or recorded call observation",
    },
    {
      code: "ROLEPLAY",
      name: "Roleplay",
      description: "Practice scenario / talk track",
    },
    {
      code: "FIELD_VISIT",
      name: "Field Visit",
      description: "In-person field coaching",
    },
  ];

  for (const at of activityTypes) {
    await prisma.activityType.upsert({
      where: { code: at.code },
      update: {
        name: at.name,
        description: at.description,
        isActive: true,
        archivedAt: null,
      },
      create: at,
    });
  }

  const monitoringCategories: {
    code: string;
    name: string;
    description: string;
    sortOrder: number;
    items: { code: string; label: string; sortOrder: number }[];
  }[] = [
    {
      code: "MORNING_ROUTINE",
      name: "Morning Routine",
      description: "Start-of-day preparation and planning habits",
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
          label: "Top 3 priorities clearly defined",
          sortOrder: 3,
        },
      ],
    },
    {
      code: "TIME_MANAGEMENT",
      name: "Time Management",
      description: "Calendar discipline and focus blocks",
      sortOrder: 2,
      items: [
        {
          code: "CALENDAR_BLOCKED",
          label: "Focus / prospecting time blocked on calendar",
          sortOrder: 1,
        },
        {
          code: "MEETING_HYGIENE",
          label: "Meetings start/end on time with agenda",
          sortOrder: 2,
        },
        {
          code: "DISTRACTION_CONTROL",
          label: "Distractions managed during selling blocks",
          sortOrder: 3,
        },
      ],
    },
    {
      code: "COLLABORATION",
      name: "Collaboration",
      description: "Peer, support, and leadership collaboration",
      sortOrder: 3,
      items: [
        {
          code: "SUPPORT_SYNC",
          label: "Synced with sales support / ops as needed",
          sortOrder: 1,
        },
        {
          code: "HANDOFF_QUALITY",
          label: "Handoffs include clear next steps",
          sortOrder: 2,
        },
        {
          code: "TEAM_COMMUNICATION",
          label: "Proactive communication with Team Lead",
          sortOrder: 3,
        },
      ],
    },
    {
      code: "SALES_SKILLS",
      name: "Sales Skills",
      description: "Discovery, qualification, and closing behaviors",
      sortOrder: 4,
      items: [
        {
          code: "DISCOVERY_DEPTH",
          label: "Discovery questions uncover business impact",
          sortOrder: 1,
        },
        {
          code: "NEXT_STEP_SET",
          label: "Clear next step agreed with customer",
          sortOrder: 2,
        },
        {
          code: "OBJECTION_HANDLING",
          label: "Objections handled without discount-first reflex",
          sortOrder: 3,
        },
      ],
    },
    {
      code: "ADDITIONAL_OBSERVATIONS",
      name: "Additional Observations",
      description: "Catch-all checklist plus free-form notes",
      sortOrder: 5,
      items: [
        {
          code: "COACHING_MOMENT",
          label: "Notable coaching moment observed",
          sortOrder: 1,
        },
        {
          code: "RISK_FLAG",
          label: "Performance risk flagged for follow-up",
          sortOrder: 2,
        },
      ],
    },
  ];

  for (const cat of monitoringCategories) {
    const category = await prisma.monitoringCategory.upsert({
      where: { code: cat.code },
      update: {
        name: cat.name,
        description: cat.description,
        sortOrder: cat.sortOrder,
        isActive: true,
        archivedAt: null,
      },
      create: {
        code: cat.code,
        name: cat.name,
        description: cat.description,
        sortOrder: cat.sortOrder,
      },
    });

    for (const item of cat.items) {
      await prisma.monitoringChecklistItem.upsert({
        where: {
          categoryId_code: { categoryId: category.id, code: item.code },
        },
        update: {
          label: item.label,
          sortOrder: item.sortOrder,
          isActive: true,
          archivedAt: null,
        },
        create: {
          categoryId: category.id,
          code: item.code,
          label: item.label,
          sortOrder: item.sortOrder,
        },
      });
    }
  }

  console.log("Seed complete.");
  if (demoSummary) {
    console.log(`Dev password for all demo users: ${DEV_PASSWORD}`);
    console.log(demoSummary);
  } else {
    console.log(
      "Demo users were skipped (production or SEED_DEMO_USERS=false). Roles, permissions, activity types, and monitoring checklists were upserted.",
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
