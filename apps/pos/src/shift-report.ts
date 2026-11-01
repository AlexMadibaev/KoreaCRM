import type { PosMethodTotal, PosShiftReport } from '@koreacrm/types';
import { formatMinor } from './calculations.ts';

export const cashOperationLabels: Record<string, string> = { DEPOSIT: 'Внесение', WITHDRAWAL: 'Изъятие', EXPENSE: 'Расход', CORRECTION: 'Корректировка' };

// Difference between counted and expected cash; negative means a shortage.
export function cashVariance(countedMinor: string, expectedMinor: string): bigint | null {
  if (!/^\d+$/.test(countedMinor) || !/^-?\d+$/.test(expectedMinor)) return null;
  return BigInt(countedMinor) - BigInt(expectedMinor);
}

export function varianceLabel(variance: bigint): string {
  if (variance === 0n) return 'Совпадает';
  return variance < 0n ? `Недостача ${formatMinor(-variance)}` : `Излишек ${formatMinor(variance)}`;
}

const methodRows = (rows: PosMethodTotal[]) => rows.map(row => `  ${row.name}: ${formatMinor(row.amountMinor)}`);

/** Plain text lines of the X/Z report, used for the receipt printer. */
export function shiftReportLines(report: PosShiftReport): string[] {
  const { shift, sales, returns, customerPayments, cash } = report;
  const closed = shift.status === 'CLOSED';
  const closingVariance = BigInt(shift.closingVarianceMinor);
  const openingVariance = BigInt(shift.openingVarianceMinor);
  return [
    closed ? 'Z-ОТЧЁТ (СМЕНА ЗАКРЫТА)' : 'X-ОТЧЁТ (СМЕНА ОТКРЫТА)',
    shift.store.name,
    `Касса: ${shift.deviceId}`,
    `Открыл: ${shift.openedBy} ${new Date(shift.openedAt).toLocaleString('ru-RU')}`,
    closed && shift.closedAt ? `Закрыл: ${shift.closedBy ?? ''} ${new Date(shift.closedAt).toLocaleString('ru-RU')}` : `Время отчёта: ${new Date().toLocaleString('ru-RU')}`,
    '--------------------------------',
    `Продажи: ${sales.count} на ${formatMinor(sales.totalMinor)}`,
    `  Скидки: ${formatMinor(sales.discountMinor)}`,
    ...methodRows(sales.byMethod),
    `  В долг выдано: ${formatMinor(sales.debtMinor)}`,
    `Возвраты: ${returns.count} на ${formatMinor(returns.amountMinor)}`,
    ...(returns.receiptlessCount ? [`  в т.ч. без чека: ${returns.receiptlessCount} на ${formatMinor(returns.receiptlessMinor ?? '0')}`] : []),
    ...methodRows(returns.byMethod),
    `Погашение долгов: ${customerPayments.count} на ${formatMinor(customerPayments.amountMinor)}`,
    ...methodRows(customerPayments.byMethod),
    '--------------------------------',
    'НАЛИЧНЫЕ В КАССЕ',
    `  На начало: ${formatMinor(cash.openingMinor)}`,
    `  Продажи: +${formatMinor(cash.salesMinor)}`,
    `  Погашение долгов: +${formatMinor(cash.customerPaymentsMinor)}`,
    `  Возвраты: ${formatMinor(cash.refundsMinor)}`,
    `  Внесения: +${formatMinor(cash.depositsMinor)}`,
    `  Изъятия: ${formatMinor(cash.withdrawalsMinor)}`,
    ...(cash.expensesMinor !== '0' ? [`  Расходы: ${formatMinor(cash.expensesMinor)}`] : []),
    ...(cash.correctionsMinor !== '0' ? [`  Корректировки: ${formatMinor(cash.correctionsMinor)}`] : []),
    `  ${closed ? 'Итого' : 'Сейчас'}: ${formatMinor(cash.expectedMinor)}`,
    ...(openingVariance !== 0n ? [`При открытии: ${varianceLabel(openingVariance)}`, shift.openingComment ? `  ${shift.openingComment}` : ''] : []),
    ...(closed ? [`Пересчёт: ${formatMinor(shift.actualCashMinor ?? '0')} (${varianceLabel(closingVariance)})`, shift.closingComment ? `  ${shift.closingComment}` : ''] : []),
  ].filter(Boolean);
}
