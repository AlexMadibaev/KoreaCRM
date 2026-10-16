import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

export const listSchema = z.object({ page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().min(1).max(100).default(20) });
export const countSchema = z.object({ productId: z.string().uuid(), actualQuantity: z.number().int().min(0).max(2_147_483_647) });
export const scanSchema = z.object({ barcode: z.string().trim().min(1) });
export const completeSchema = z.object({ countUncountedAsZero: z.literal(true) });

export function parseInput<T extends z.ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) throw new BadRequestException(result.error.flatten());
  return result.data;
}
