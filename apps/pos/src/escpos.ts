import type { PosSale } from '@koreacrm/types';
import { formatMinor } from './calculations.ts';

export function encodeCp866(value: string): number[] {
  const result: number[] = [];
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if (code <= 127) result.push(code);
    else if (code >= 0x410 && code <= 0x42f) result.push(0x80 + code - 0x410);
    else if (code >= 0x430 && code <= 0x43f) result.push(0xa0 + code - 0x430);
    else if (code >= 0x440 && code <= 0x44f) result.push(0xe0 + code - 0x440);
    else if (code === 0x401) result.push(0xf0);
    else if (code === 0x451) result.push(0xf1);
    else result.push(0x3f);
  }
  return result;
}

export function buildEscPosReceipt(sale: PosSale): number[] {
  const rows = [
    'KOREA CRM',
    sale.store.name,
    sale.store.address ?? '',
    sale.store.phone ?? '',
    'НЕФИСКАЛЬНЫЙ ЧЕК',
    `Чек ${sale.number}`,
    new Date(sale.createdAt).toLocaleString('ru-RU'),
    `Кассир: ${sale.employee.name}`,
    '--------------------------------',
    ...sale.items.flatMap(item => [`${item.product.name} x ${item.quantity}`, `${formatMinor(item.priceMinor)}   ${formatMinor(item.totalMinor)}`]),
    '--------------------------------',
    `Скидка: ${formatMinor(sale.discountMinor)}`,
    `ИТОГО: ${formatMinor(sale.totalMinor)}`,
    ...sale.payments.map(payment => `${payment.paymentMethod.name}: ${formatMinor(payment.amountMinor)}`),
    sale.customer ? `Клиент: ${sale.customer.firstName} ${sale.customer.phone}` : '',
    'Спасибо за покупку!',
  ];
  return [0x1b, 0x40, 0x1b, 0x74, 0x11, ...encodeCp866(rows.filter(Boolean).join('\n') + '\n\n\n'), 0x1d, 0x56, 0x00];
}
