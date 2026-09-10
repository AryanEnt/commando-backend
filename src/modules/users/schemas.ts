import { z } from "zod";
import { ROLE_CODES } from "../../lib/permissions.js";

const roleCodeSchema = z.enum(ROLE_CODES);

export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password must be at most 128 characters")
  .refine(
    (value) => /[A-Za-z]/.test(value) && /\d/.test(value),
    "Password must include at least one letter and one number",
  );

export const createUserSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z
    .string()
    .trim()
    .email()
    .max(254)
    .transform((value) => value.toLowerCase()),
  password: passwordSchema,
  roleCode: roleCodeSchema,
  isActive: z.boolean().optional().default(true),
  teamId: z.string().min(1).optional().nullable(),
});

export const updateUserSchema = z
  .object({
    firstName: z.string().trim().min(1).max(80).optional(),
    lastName: z.string().trim().min(1).max(80).optional(),
    email: z
      .string()
      .trim()
      .email()
      .max(254)
      .transform((value) => value.toLowerCase())
      .optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field is required",
  });

export const updateUserStatusSchema = z.object({
  isActive: z.boolean(),
});

export const updateUserRoleSchema = z.object({
  roleCode: roleCodeSchema,
});

export const createSalesExecutiveSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z
    .string()
    .trim()
    .email()
    .max(254)
    .transform((value) => value.toLowerCase()),
  password: passwordSchema,
  isActive: z.boolean().optional().default(true),
  teamId: z.string().min(1),
  displayName: z.string().trim().min(1).max(160),
  employeeCode: z.string().trim().max(64).optional().nullable(),
});

export const listUsersQuerySchema = z.object({
  search: z.string().trim().optional(),
  roleCode: roleCodeSchema.optional(),
  teamId: z.string().min(1).optional(),
  isActive: z
    .enum(["true", "false"])
    .optional()
    .transform((value) =>
      value === undefined ? undefined : value === "true",
    ),
  profileStatus: z.enum(["created", "missing", "n_a"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z
    .enum(["createdAt", "updatedAt", "email", "firstName", "lastName"])
    .optional()
    .default("createdAt"),
  order: z.enum(["asc", "desc"]).optional().default("desc"),
});
