import { PrismaClient } from "@prisma/client";
import {
  ALL_PERMISSION_CODES,
  PERMISSION_META,
  ROLE_PERMISSION_MAP,
} from "../src/lib/permissions.js";

const prisma = new PrismaClient();

async function main() {
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

  const permissions = await prisma.permission.findMany();
  const permissionByCode = new Map(permissions.map((p) => [p.code, p.id]));
  const roles = await prisma.role.findMany();

  for (const role of roles) {
    const allowed = ROLE_PERMISSION_MAP[role.code as keyof typeof ROLE_PERMISSION_MAP];
    if (!allowed) continue;
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
  }

  console.log("Role permissions synced");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
