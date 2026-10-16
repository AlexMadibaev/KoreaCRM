import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

export const stockTypeSchema = z.enum(['PURCHASE', 'SALE', 'RETURN', 'TRANSFER_IN', 'TRANSFER_OUT', 'WRITE_OFF', 'INVENTORY', 'CORRECTION', 'SUPPLIER_RETURN']);
export const stockListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(255).optional(),
  filter: z.enum(['all', 'low', 'negative', 'zero']).default('all'),
  brandId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
});
export const movementListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  productId: z.string().uuid().optional(),
  type: stockTypeSchema.optional(),
});
export const adjustmentSchema = z.object({
  productId: z.string().uuid(),
  type: z.enum(['CORRECTION', 'INVENTORY']),
  delta: z.number().int().min(-2_147_483_647).max(2_147_483_647).refine((value) => value !== 0, 'Quantity change cannot be zero'),
  comment: z.string().trim().min(3).max(1000),
});
export const writeOffSchema = z.object({
  operationId: z.string().uuid(),
  productId: z.string().uuid(),
  quantity: z.number().int().min(1).max(2_147_483_647),
  comment: z.string().trim().min(3).max(1000),
});

export function parseStockInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new BadRequestException(result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`));
  return result.data;
}
