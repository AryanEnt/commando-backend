import type { NextFunction, Request, Response } from "express";
import { badRequest } from "../../lib/errors.js";
import type { AuthUser } from "../../types/auth.js";
import * as usersService from "./service.js";
import {
  createSalesExecutiveSchema,
  createUserSchema,
  listUsersQuerySchema,
  updateUserRoleSchema,
  updateUserSchema,
  updateUserStatusSchema,
} from "./schemas.js";
import { prisma } from "../../lib/prisma.js";

function paramId(value: string | string[] | undefined): string {
  const id = Array.isArray(value) ? value[0] : value;
  if (!id) throw badRequest("Missing resource id");
  return id;
}

function actorFrom(req: Request) {
  return req.user as AuthUser;
}

export async function listUsers(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const query = listUsersQuerySchema.parse(req.query);
    const result = await usersService.listUsers(actorFrom(req), query);
    res.status(200).json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function getUser(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = await usersService.getUser(actorFrom(req), paramId(req.params.id));
    res.status(200).json({ data: { user } });
  } catch (err) {
    next(err);
  }
}

export async function getUserProfile(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await usersService.getUserProfile(
      actorFrom(req),
      paramId(req.params.id),
    );
    res.status(200).json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function createUser(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const input = createUserSchema.parse(req.body);
    const user = await usersService.createUser(actorFrom(req), input);
    res.status(201).json({ data: { user } });
  } catch (err) {
    next(err);
  }
}

export async function updateUser(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const input = updateUserSchema.parse(req.body);
    const user = await usersService.updateUser(
      actorFrom(req),
      paramId(req.params.id),
      input,
    );
    res.status(200).json({ data: { user } });
  } catch (err) {
    next(err);
  }
}

export async function changeUserStatus(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const input = updateUserStatusSchema.parse(req.body);
    const user = await usersService.changeUserStatus(
      actorFrom(req),
      paramId(req.params.id),
      input,
    );
    res.status(200).json({ data: { user } });
  } catch (err) {
    next(err);
  }
}

export async function changeUserRole(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const input = updateUserRoleSchema.parse(req.body);
    const user = await usersService.changeUserRole(
      actorFrom(req),
      paramId(req.params.id),
      input,
    );
    res.status(200).json({ data: { user } });
  } catch (err) {
    next(err);
  }
}

export async function createSalesExecutive(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const input = createSalesExecutiveSchema.parse(req.body);
    const result = await usersService.createSalesExecutive(
      actorFrom(req),
      input,
    );
    res.status(201).json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function listRoles(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const roles = await prisma.role.findMany({
      include: {
        rolePermissions: {
          include: { permission: true },
        },
      },
      orderBy: { code: "asc" },
    });

    res.status(200).json({
      data: {
        roles: roles.map((role) => ({
          id: role.id,
          code: role.code,
          name: role.name,
          description: role.description,
          permissions: role.rolePermissions.map((rp) => rp.permission.code),
        })),
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function listPermissions(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const permissions = await prisma.permission.findMany({
      orderBy: { code: "asc" },
    });
    res.status(200).json({ data: { permissions } });
  } catch (err) {
    next(err);
  }
}
