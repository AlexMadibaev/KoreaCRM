import { z } from 'zod';
import { BadRequestException } from '@nestjs/common';

export const idSchema = z.string().uuid();
export const pageSchema = z.coerce.number().int().min(1).default(1);
export const limitSchema = z.coerce.number().int().min(1).max(100).default(20);
export const brandSchema = z.object({ name: z.string().trim().min(1).max(120) });
export const categorySchema = z.object({
  name: z.string().trim().min(1).max(120),
  parentId: idSchema.nullable().optional(),
});
const optionalText = z.string().trim().max(255).nullable().optional();
export const productSchema = z.object({
  name: z.string().trim().min(1).max(255),
  sku: z.string().trim().min(1).max(100),
  brandId: idSchema.nullable().optional(),
  categoryId: idSchema.nullable().optional(),
  description: z.string().max(5000).nullable().optional(),
  country: optionalText,
  unit: z.string().trim().min(1).max(32).default('pcs'),
  status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
  shade: optionalText,
  volume: optionalText,
  weight: optionalText,
  line: optionalText,
  collection: optionalText,
  gender: optionalText,
  skinType: optionalText,
  productType: optionalText,
  barcodes: z.array(z.string().trim().min(1).max(120)).max(30).default([]),
  imageKeys: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
});
export const productUpdateSchema = productSchema.partial().extend({
  unit: z.string().trim().min(1).max(32).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  barcodes: z.array(z.string().trim().min(1).max(120)).max(30).optional(),
  imageKeys: z.array(z.string().trim().min(1).max(500)).max(20).optional(),
});
export const storeSettingsSchema = z.object({
  priceMinor: z.number().int().min(0).max(2_147_483_647).nullable(),
  minStock: z.number().int().min(0).max(2_147_483_647),
  active: z.boolean(),
}).partial().refine((value) => Object.keys(value).length > 0, 'At least one setting is required');
export const productQuerySchema = z.object({
  page: pageSchema,
  limit: limitSchema,
  search: z.string().trim().max(255).optional(),
  sku: z.string().trim().max(100).optional(),
  barcode: z.string().trim().max(120).optional(),
  brandId: idSchema.optional(),
  categoryId: idSchema.optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});

export function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new BadRequestException(issues);
  }
  return result.data;
}
