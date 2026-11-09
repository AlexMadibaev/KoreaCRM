'use client';

import { useState } from 'react';
import { formatCurrencyMinor as money } from '@koreacrm/ui';

export type ShiftRewardPreview = { cash: { expectedMinor: string }; reward?: { employeeName: string; payableMinor: string } };

export function ShiftRewardConfirmation({ preview, actualMinor, busy, onConfirm, onClose }: { preview: ShiftRewardPreview; actualMinor: string; busy: boolean; onConfirm: () => void; onClose: () => void }) {
  const [confirmed, setConfirmed] = useState(false);
  const remaining = BigInt(actualMinor) - BigInt(preview.reward?.payableMinor ?? '0');
  return <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-4"><section role="dialog" aria-modal="true" aria-labelledby="shift-reward-title" className="w-full max-w-lg space-y-4 rounded-2xl bg-white p-6">
    <h2 id="shift-reward-title" className="text-xl font-semibold">Сверка и выплата при закрытии</h2>
    <p>Ожидается в кассе до выплаты: <strong>{money(preview.cash.expectedMinor)}</strong></p>
    <p>Пересчитано до выплаты: <strong>{money(actualMinor)}</strong></p>
    {preview.reward ? <><p>Вознаграждение: {preview.reward.employeeName} — <strong>{money(preview.reward.payableMinor)}</strong></p><p>Останется для следующей смены: <strong>{money(remaining.toString())}</strong></p>{remaining < 0n && <p role="alert">Наличных недостаточно. Пополните кассу перед закрытием.</p>}<label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /> Наличные пересчитаны, выплату сотруднику и остаток подтверждаю.</label><p className="text-sm text-slate-600">Заберите вознаграждение только после успешного закрытия. Выплата будет учтена в истории сотрудника и движении кассы.</p></> : <p role="alert">Обновите API для расчёта вознаграждения.</p>}
    <div className="flex justify-end gap-3"><button type="button" disabled={busy} onClick={onClose} className="ks-button ks-button--secondary">Отмена</button><button type="button" disabled={busy || !confirmed || !preview.reward || remaining < 0n} onClick={onConfirm} className="ks-button ks-button--primary">Подтвердить и закрыть</button></div>
  </section></div>;
}
