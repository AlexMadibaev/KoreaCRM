import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

const uuid = z.string().uuid();
const login = z.string().trim().min(3).max(60).regex(/^[a-zA-Z0-9._-]+$/);
const password = z.string().min(12).max(128);
const pin = z.string().regex(/^\d{4,8}$/);
const scope = { roleId: uuid, allStores: z.boolean().default(false), storeIds: z.array(uuid).max(100).default([]) };
export const employeeListSchema = z.object({ search: z.string().trim().max(100).optional(), page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().min(1).max(100).default(20) });
export const employeeActivitySchema = z.object({ page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().min(1).max(100).default(20) });
export const employeeCreateSchema = z.object({ name: z.string().trim().min(2).max(150), login, password, pin: pin.optional(), ...scope });
export const employeePatchSchema = z.object({ name: z.string().trim().min(2).max(150).optional(), login: login.optional(), password: password.optional(), pin: pin.nullable().optional(), roleId: uuid.optional(), allStores: z.boolean().optional(), storeIds: z.array(uuid).max(100).optional(), active: z.boolean().optional() }).refine(value => Object.keys(value).length > 0);
const roleFields = { name: z.string().trim().min(2).max(100), permissions: z.array(z.string().trim().min(3).max(100)).max(100) };
export const roleCreateSchema = z.object({ code: z.string().trim().regex(/^[A-Z][A-Z0-9_]{2,39}$/), ...roleFields });
export const rolePatchSchema = z.object({ name: roleFields.name.optional(), permissions: roleFields.permissions.optional() }).refine(value => Object.keys(value).length > 0);
export function parseEmployeeInput<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw new BadRequestException(result.error.flatten());
  return result.data;
}
