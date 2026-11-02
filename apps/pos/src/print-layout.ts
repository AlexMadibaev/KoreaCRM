import type { PosSale } from '@koreacrm/types';
import { formatMinor } from './calculations.ts';

// Printing through Windows (USB receipt printers such as POS-80C) renders a separate block
// at the end of <body>; print styles hide everything else on the page.
type Row = { left: string; right?: string; strong?: boolean; center?: boolean; big?: boolean; rule?: boolean };

export function receiptRows(sale: PosSale): Row[] {
  const returned = (sale.returns ?? []).reduce((total, record) => total + BigInt(record.amountMinor), 0n);
  return [
    { left: 'KOREA CRM', center: true, strong: true, big: true },
    { left: sale.store.name, center: true },
    ...(sale.store.address ? [{ left: sale.store.address, center: true }] : []),
    ...(sale.store.phone ? [{ left: sale.store.phone, center: true }] : []),
    { left: 'НЕФИСКАЛЬНЫЙ ЧЕК', center: true, strong: true },
    { left: '', rule: true },
    { left: `Чек № ${sale.number}`, right: new Date(sale.createdAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) },
    { left: `Кассир: ${sale.employee.name}` },
    ...(sale.seller ? [{ left: `Продавец: ${sale.seller.name}` }] : []),
    ...(sale.customer ? [{ left: `Клиент: ${sale.customer.firstName} ${sale.customer.lastName ?? ''}`.trim() }, { left: sale.customer.phone }] : []),
    { left: '', rule: true },
    ...sale.items.flatMap(item => [
      { left: item.product.name, strong: true },
      { left: `${item.quantity} × ${formatMinor(item.priceMinor)}${item.discountMinor !== '0' ? ` − ${formatMinor(item.discountMinor)}` : ''}`, right: formatMinor(item.totalMinor) },
    ]),
    { left: '', rule: true },
    ...(sale.discountMinor !== '0' ? [{ left: 'Скидка', right: formatMinor(sale.discountMinor) }] : []),
    { left: 'ИТОГО', right: `${formatMinor(sale.totalMinor)} смн.`, strong: true, big: true },
    ...sale.payments.map(payment => ({ left: payment.paymentMethod.name, right: formatMinor(payment.amountMinor) })),
    ...(sale.comment ? [{ left: sale.comment }] : []),
    ...(returned > 0n ? [{ left: '', rule: true }, { left: 'ВОЗВРАТ', right: formatMinor(returned), strong: true }, ...(sale.returns ?? []).flatMap(record => (record.payments ?? []).map(part => ({ left: `  ${part.paymentMethod.name}`, right: formatMinor(part.amountMinor) })))] : []),
    { left: '', rule: true },
    { left: 'Спасибо за покупку!', center: true },
  ];
}

export function textRows(lines: string[]): Row[] {
  return lines.filter(Boolean).map(line => line.startsWith('---') ? { left: '', rule: true } : { left: line });
}

function render(rows: Row[]): HTMLElement {
  const root = document.createElement('div');
  root.id = 'print-root';
  for (const row of rows) {
    const line = document.createElement('div');
    line.className = ['print-row', row.rule ? 'is-rule' : '', row.strong ? 'is-strong' : '', row.center ? 'is-center' : '', row.big ? 'is-big' : ''].filter(Boolean).join(' ');
    if (!row.rule) {
      const left = document.createElement('span');
      left.textContent = row.left;
      line.append(left);
      if (row.right !== undefined) { const right = document.createElement('span'); right.textContent = row.right; line.append(right); }
    }
    root.append(line);
  }
  return root;
}

/** Opens the Windows print dialog with only the given rows on an 80 mm page. */
export function printRows(rows: Row[]) {
  document.getElementById('print-root')?.remove();
  const root = render(rows);
  document.body.append(root);
  const cleanup = () => { root.remove(); window.removeEventListener('afterprint', cleanup); };
  window.addEventListener('afterprint', cleanup);
  window.print();
}
