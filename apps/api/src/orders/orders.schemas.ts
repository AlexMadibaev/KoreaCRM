import { z } from 'zod';

const uuid = z.string().uuid();
export const orderStatuses = [
  'DRAFT',
  'CONFIRMED',
  'READY',
  'COMPLETED',
  'CANCELLED',
] as const;
const item = z.object({
  productId: uuid,
  quantity: z.number().int().min(1).max(100000),
});
export const orderDraftSchema = z
  .object({
    customerId: uuid.nullable().optional(),
    deliveryMethod: z.enum(['PICKUP', 'DELIVERY']).default('PICKUP'),
    deliveryAddress: z.string().trim().max(1000).default(''),
    contactPhone: z.string().trim().max(50).default(''),
    comment: z.string().trim().max(1000).default(''),
    items: z
      .array(item)
      .min(1)
      .max(100)
      .refine(
        (items) =>
          new Set(items.map((item) => item.productId)).size === items.length,
        'Duplicate order products',
      ),
  })
  .refine(
    (order) =>
      order.deliveryMethod !== 'DELIVERY' ||
      Boolean(order.deliveryAddress && order.contactPhone),
    'Delivery requires an address and phone',
  );
export const createOrderSchema = z.object({
  operationId: uuid,
  draft: orderDraftSchema,
});
export const editOrderSchema = z.object({
  version: z.number().int().min(0),
  draft: orderDraftSchema,
});
export const confirmOrderSchema = z.object({
  version: z.number().int().min(0),
});
export const orderListSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(orderStatuses).optional(),
  search: z.string().trim().max(100).optional(),
});
export const orderPaymentSchema = z.object({
  operationId: uuid,
  paymentMethodId: uuid,
  amountMinor: z.string().regex(/^[1-9]\d{0,17}$/),
  cashShiftId: uuid.optional(),
});
export const completeOrderSchema = z.object({
  operationId: uuid,
  cashShiftId: uuid,
});
export const cancelOrderSchema = z.object({
  operationId: uuid,
  cashShiftId: uuid.optional(),
  reason: z.string().trim().min(3).max(1000),
});
