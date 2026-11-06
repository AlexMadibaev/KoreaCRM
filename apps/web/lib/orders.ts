export const orderStatusLabels = {
  DRAFT: 'Черновик',
  CONFIRMED: 'Подтверждён',
  READY: 'Готов к выдаче',
  COMPLETED: 'Выдан',
  CANCELLED: 'Отменён',
};

export type OrderStatus = keyof typeof orderStatusLabels;
export type OrderDraft = {
  customerId?: string | null;
  deliveryMethod: 'PICKUP' | 'DELIVERY';
  deliveryAddress: string;
  contactPhone: string;
  comment: string;
  items: { productId: string; quantity: number }[];
};

export const paymentStatusLabels = {
  UNPAID: 'Не оплачен',
  PARTIALLY_PAID: 'Частично оплачен',
  PAID: 'Оплачен',
};
export type CustomerOrder = {
  paymentStatus: keyof typeof paymentStatusLabels;
  id: string;
  number: number;
  version: number;
  status: OrderStatus;
  totalMinor: string;
  paidMinor: string;
  customerId: string | null;
  customer: { id?: string; firstName: string; phone: string } | null;
  deliveryMethod: 'PICKUP' | 'DELIVERY';
  deliveryAddress: string;
  contactPhone: string;
  comment: string;
  createdAt: string;
  items: {
    id: string;
    productId: string;
    name: string;
    sku: string;
    quantity: number;
    priceMinor: string;
    discountMinor: string;
    totalMinor: string;
  }[];
  payments: {
    id: string;
    amountMinor: string;
    createdAt: string;
    paymentMethod: { name: string; kind: string };
  }[];
  events: {
    id: string;
    action: string;
    details: Record<string, unknown>;
    createdAt: string;
    employee: { name: string };
  }[];
  sale: {
    id: string;
    number: string;
    returns: { id: string; amountMinor: string; createdAt: string }[];
  } | null;
};
