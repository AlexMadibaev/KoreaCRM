import type { Prisma } from '@prisma/client';

export function paymentMethodStoreFilter(storeId: string): Prisma.SalePaymentMethodWhereInput {
  return { OR: [{ restrictedToStores: false }, { storeBindings: { some: { storeId } } }] };
}