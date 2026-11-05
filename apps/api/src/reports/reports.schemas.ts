import { z } from 'zod';

const uuid = z.string().uuid();
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const reportKeys = [
  'sales-by-day',
  'sales-by-product',
  'sales-by-category',
  'sales-by-store',
  'sales-by-employee',
  'gross-profit',
  'cost',
  'stock',
  'stock-movements',
  'finance-operations',
  'returns',
  'debts',
  'discounts',
  'customer-activity',
] as const;
export type ReportKey = (typeof reportKeys)[number];

export const reportQuerySchema = z.object({
  from: dateOnly.optional(),
  to: dateOnly.optional(),
  storeId: uuid.optional(),
  scope: z.enum(['active', 'all']).optional(),
  employeeId: uuid.optional(),
  categoryId: uuid.optional(),
  q: z.string().trim().max(100).optional(),
  lowOnly: z.enum(['1', 'true']).optional(),
  sort: z.string().regex(/^[a-zA-Z]{1,40}$/).optional(),
  dir: z.enum(['asc', 'desc']).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  export: z.enum(['1', 'true']).optional(),
});
export type ReportQuery = z.infer<typeof reportQuerySchema>;
