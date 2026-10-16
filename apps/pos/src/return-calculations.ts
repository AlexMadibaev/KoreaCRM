import type { PosSale } from '@koreacrm/types';

export function returnedQuantity(sale: PosSale, saleItemId: string) {
  return (sale.returns ?? []).reduce((total, record) => total + record.items.filter(item => item.saleItemId === saleItemId).reduce((sum, item) => sum + item.quantity, 0), 0);
}

export function returnAmount(sale: PosSale, quantities: Record<string, number>) {
  return sale.items.reduce((total, item) => {
    const already = returnedQuantity(sale, item.id);
    const quantity = quantities[item.id] ?? 0;
    if (!Number.isInteger(quantity) || quantity < 0 || quantity > item.quantity - already) throw new Error('Количество возврата превышает доступное');
    const price = BigInt(item.totalMinor);
    const count = BigInt(item.quantity);
    return total + price * BigInt(already + quantity) / count - price * BigInt(already) / count;
  }, 0n);
}

export function fullyReturned(sale: PosSale) {
  return sale.items.every(item => returnedQuantity(sale, item.id) >= item.quantity);
}
