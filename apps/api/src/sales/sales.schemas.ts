import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
const uuid = z.string().uuid();
const money = z.string().regex(/^(0|[1-9]\d{0,17})$/);
export const saleSchema = z.object({ operationId: uuid, deviceId: z.string().trim().min(1).max(100), cashShiftId: uuid.optional(), customerId: uuid.optional(), sellerId: uuid.optional(), comment: z.string().trim().max(500).optional(), items: z.array(z.object({ productId: uuid, quantity: z.number().int().positive().max(100000), priceMinor: money.optional(), discountMinor: money.default('0') })).min(1).max(100), payments: z.array(z.object({ paymentMethodId: uuid, amountMinor: money, reference: z.string().trim().max(200).optional() })).min(1).max(20) });
export const receiptEditSchema = z.object({
  operationId: uuid,
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  sellerId: uuid.nullable(),
  customerId: uuid.nullable(),
  comment: z.string().trim().max(500),
  reason: z.string().trim().min(5).max(500),
  void: z.boolean().default(false),
  items: z.array(z.object({ productId: uuid, quantity: z.number().int().positive().max(100000), priceMinor: money, discountMinor: money })).max(100),
  payments: z.array(z.object({ paymentMethodId: uuid, amountMinor: money, reference: z.string().trim().max(200).optional() })).max(20),
});
export const saleListSchema = z.object({ page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().min(1).max(100).default(20), search: z.string().trim().max(100).optional(), from: z.iso.datetime({ offset: true }).optional(), to: z.iso.datetime({ offset: true }).optional() });
export const saleReturnListSchema = saleListSchema;
export const returnSaleSchema = z.object({ operationId: uuid, deviceId: z.string().trim().min(1).max(100), cashShiftId: uuid, reason: z.string().trim().min(5).max(500), items: z.array(z.object({ saleItemId: uuid, quantity: z.number().int().positive().max(100000) })).min(1).max(100).optional() });
export const receiptlessReturnSchema = z.object({ operationId: uuid, deviceId: z.string().trim().min(1).max(100), cashShiftId: uuid, productId: uuid, quantity: z.number().int().positive().max(100000), amountMinor: z.string().regex(/^[1-9]\d{0,17}$/), reason: z.string().trim().min(5).max(500) });
export const paymentMethodSchema = z.object({ code: z.string().regex(/^[A-Z][A-Z0-9_]{1,31}$/).optional(), name: z.string().trim().min(1).max(100), kind: z.enum(['CASH', 'CARD', 'QR', 'TRANSFER', 'CUSTOM']), sortOrder: z.number().int().min(0).max(9999).optional() });
export const paymentMethodPatchSchema = z.object({ name: z.string().trim().min(1).max(100).optional(), active: z.boolean().optional(), sortOrder: z.number().int().min(0).max(9999).optional() });
export function parseInput<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> { const result = schema.safeParse(value); if (!result.success) throw new BadRequestException(result.error.flatten()); return result.data; }
