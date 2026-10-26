import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { segmentCodes } from './customer-segments';

const uuid = z.string().uuid();
const nullableText = z.string().trim().nullable().optional();
const discount = z.string().regex(/^\d{1,3}(?:\.\d{1,2})?$/).refine((value) => Number(value) <= 100, 'Discount cannot exceed 100%');
export const listSchema = z.object({ page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().min(1).max(100).default(20), search: z.string().trim().max(100).optional(), segment: z.enum(segmentCodes).optional() });
export const historySchema = z.object({ kind: z.enum(['sales', 'returns', 'debts']), page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().min(1).max(50).default(10) });
export const commentListSchema = z.object({ page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().min(1).max(50).default(10) });
export const activitySchema = z.object({ page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().min(1).max(50).default(10) });
export const commentSchema = z.object({ text: z.string().trim().min(1).max(2000) });
export const bonusListSchema = z.object({ page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().min(1).max(50).default(10) });
export const bonusCorrectionSchema = z.object({ operationId: uuid, deltaMinor: z.string().regex(/^-?[1-9]\d{0,15}$/), reason: z.string().trim().min(5).max(500) });
export const createSchema = z.object({ firstName: z.string().trim().min(1).max(100), lastName: nullableText, phone: z.string().regex(/^\+[1-9]\d{7,14}$/, 'Use E.164 phone number'), email: z.string().email().nullable().optional(), birthday: z.coerce.date().nullable().optional(), gender: nullableText, address: nullableText, notes: nullableText, discountPercent: discount.optional() });
export const patchSchema = createSchema.partial();
export const personalDiscountSchema = z.object({ discountPercent: discount });
export const debtPaymentSchema = z.object({ operationId: uuid, paymentMethodId: uuid, amountMinor: z.string().regex(/^[1-9]\d{0,17}$/), cashShiftId: uuid.optional() });

export function parseInput<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw new BadRequestException(result.error.flatten());
  return result.data;
}
