import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
export const storeCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  code: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_-]{1,39}$/),
  address: optionalText(500),
  phone: optionalText(40),
});
export const storePatchSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  address: optionalText(500),
  phone: optionalText(40),
  managerId: z.string().uuid().nullable().optional(),
  status: z.enum(['ACTIVE', 'PAUSED', 'ARCHIVED']).optional(),
}).refine(input => Object.keys(input).length > 0);

export function parseStoreInput<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw new BadRequestException(result.error.flatten());
  return result.data;
}
