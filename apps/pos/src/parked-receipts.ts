// Parked (deferred) receipts live only on this till: they hold no stock and reach the server once paid.
export type ParkedReceipt<Line, Customer> = { id: string; label: string; createdAt: string; lines: Line[]; customer: Customer | null };

const key = (storeId: string, deviceId: string) => `koreacrm-pos-parked-v1:${storeId}:${deviceId}`;
export const maxParkedReceipts = 20;

export function readParked<Line, Customer>(storage: Pick<Storage, 'getItem'>, storeId: string, deviceId: string): ParkedReceipt<Line, Customer>[] {
  try {
    const raw = storage.getItem(key(storeId, deviceId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed as ParkedReceipt<Line, Customer>[] : [];
  } catch { return []; }
}

export function writeParked<Line, Customer>(storage: Pick<Storage, 'setItem' | 'removeItem'>, storeId: string, deviceId: string, receipts: ParkedReceipt<Line, Customer>[]) {
  try {
    if (receipts.length) storage.setItem(key(storeId, deviceId), JSON.stringify(receipts));
    else storage.removeItem(key(storeId, deviceId));
  } catch { /* Storage can be unavailable; the parked list then lasts until the window closes. */ }
}

export function parkReceipt<Line, Customer>(receipts: ParkedReceipt<Line, Customer>[], receipt: Omit<ParkedReceipt<Line, Customer>, 'id' | 'createdAt'>, now = new Date(), id: string = crypto.randomUUID()): ParkedReceipt<Line, Customer>[] {
  if (receipts.length >= maxParkedReceipts) throw new Error(`Можно отложить не больше ${maxParkedReceipts} чеков. Завершите или удалите старые.`);
  return [...receipts, { ...receipt, id, createdAt: now.toISOString() }];
}

export function defaultParkedLabel(count: number, customerName: string | null) {
  return customerName ? `Чек ${count + 1} · ${customerName}` : `Чек ${count + 1}`;
}
