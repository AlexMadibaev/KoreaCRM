import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

const uuid = z.string().uuid();
const quantity = z.number().int().positive().max(2_147_483_647);
const itemSchema = z.object({ productId: uuid, quantity });
export const listSchema = z.object({ page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().min(1).max(100).default(20), storeId: uuid.optional() });
export const createSchema = z.object({ fromStoreId: uuid, toStoreId: uuid, items: z.array(itemSchema).min(1) });
export const editSchema = z.object({ toStoreId: uuid.optional(), items: z.array(itemSchema).min(1).optional() });
export const receiveSchema = z.object({ operationId: uuid, items: z.array(z.object({ transferItemId: uuid, quantity })).min(1) });

export function parseInput<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw new BadRequestException(result.error.flatten());
  return result.data;
}
