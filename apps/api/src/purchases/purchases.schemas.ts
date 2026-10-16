import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

const uuid = z.string().uuid();
const money = z.string().regex(/^\d{1,18}$/, 'Use an integer amount in minor units');
const text = z.string().trim().min(1);
const optionalText = z.string().trim().nullable().optional();
const quantity = z.number().int().positive().max(2_147_483_647);

export const listSchema = z.object({ page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().min(1).max(100).default(20), search: z.string().trim().optional() });
export const supplierSchema = z.object({ name: text, contactPerson: optionalText, phone: optionalText, email: z.string().email().nullable().optional(), address: optionalText, notes: optionalText, status: z.enum(['ACTIVE', 'INACTIVE']).optional() });
export const supplierPatchSchema = supplierSchema.partial();
export const purchaseItemSchema = z.object({ productId: uuid, quantityOrdered: quantity, purchasePriceMinor: money, salePriceMinor: money.nullable().optional() });
export const purchaseSchema = z.object({ supplierId: uuid, number: text, items: z.array(purchaseItemSchema).min(1) });
export const purchasePatchSchema = z.object({ supplierId: uuid.optional(), number: text.optional(), items: z.array(purchaseItemSchema).min(1).optional() });
export const receivingSchema = z.object({ operationId: uuid, items: z.array(z.object({ purchaseItemId: uuid, quantity, batchNumber: text, manufacturedAt: z.coerce.date().nullable().optional(), expiresAt: z.coerce.date().nullable().optional() })).min(1) });

export function parseInput<T extends z.ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) throw new BadRequestException(result.error.flatten());
  return result.data;
}
