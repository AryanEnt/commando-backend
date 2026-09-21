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
        "SEED_DEMO_USERS is not allowed when NODE_ENV=production. Roles and permissions are still seeded.",
      );
    }
    return false;
  }
  return process.env.SEED_DEMO_USERS !== "false";
}

/** Credentials-only seed: roles/permissions + demo login users. No teams, profiles, or catalog data. */
async function main() {
  await upsertRolesAndPermissions();

  const seedDemo = shouldSeedDemoUsers();

  if (!seedDemo) {
    console.log("Seed complete.");
    console.log(
      "Demo users were skipped (production or SEED_DEMO_USERS=false). Roles and permissions were upserted.",
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
    {
      email: "teamlead@commando.local",
      firstName: "Tina",
      lastName: "Lead",
      roleCode: "TEAM_LEAD" as const,
    },
    {
      email: "commando@commando.local",
      firstName: "Chris",
      lastName: "Commando",
      roleCode: "COMMANDO_EXECUTIVE" as const,
    },
    {
      email: "sales@commando.local",
      firstName: "Sam",
      lastName: "Seller",
      roleCode: "SALES_EXECUTIVE" as const,
    },
    {
      email: "support@commando.local",
      firstName: "Sara",
      lastName: "Support",
      roleCode: "SALES_SUPPORT_EXECUTIVE" as const,
    },
  ];

  const created: Record<string, string> = {};
  for (const user of users) {
    const row = await upsertUser(user);
    created[user.roleCode] = row.email;
  }

  console.log("Seed complete (credentials only).");
  console.log(`Dev password for all demo users: ${DEV_PASSWORD}`);
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
