import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

const uuid = z.string().uuid();
export const positiveMoney = z.string().regex(/^[1-9]\d{0,17}$/, 'Use a positive integer amount in minor units');
const nonnegativeMoney = z.string().regex(/^\d{1,18}$/, 'Use an integer amount in minor units');
const signedMoney = z.string().regex(/^-?[1-9]\d{0,17}$/, 'Use a nonzero integer amount in minor units');
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const paymentMethod = z.enum(['CASH', 'CARD', 'BANK_TRANSFER']);
export const pageSchema = z.object({ page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().min(1).max(100).default(20) });
export const categorySchema = z.object({ name: z.string().trim().min(1).max(100) });
export const expenseSchema = z.object({ operationId: uuid, categoryId: uuid, amountMinor: positiveMoney, paymentMethod, cashShiftId: uuid.optional(), description: z.string().trim().max(1000).optional(), date: dateOnly, attachmentKey: z.string().trim().max(500).optional() });
export const openShiftSchema = z.object({ deviceId: z.string().trim().min(1).max(100), openingCashMinor: nonnegativeMoney });
export const closeShiftSchema = z.object({ actualCashMinor: nonnegativeMoney });
export const cashOperationSchema = z.object({ operationId: uuid, type: z.enum(['DEPOSIT', 'WITHDRAWAL', 'CORRECTION']), amountMinor: signedMoney, comment: z.string().trim().min(1).max(1000) });
export const supplierPaymentSchema = z.object({ operationId: uuid, purchaseId: uuid, amountMinor: positiveMoney, paymentMethod, cashShiftId: uuid.optional() });
export const reportScopeSchema = z.object({ scope: z.enum(['active', 'all']).optional() });
export const summarySchema = z.object({ from: dateOnly, to: dateOnly, storeId: uuid.optional(), scope: z.enum(['active', 'all']).optional() });

export function parseInput<T extends z.ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) throw new BadRequestException(result.error.flatten());
  return result.data;
}
