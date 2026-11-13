'use client';

import { TypedInput } from '@koreacrm/ui';
export function EmployeeRewardPercent({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <label className="block">Вознаграждение от суммы чека, %
    <TypedInput required type="number" min="0" max="100" step="0.01" inputMode="decimal" className="mt-1 block w-full rounded-lg border p-2" value={value} onChange={event => onChange(event.target.value)} />
    <small className="mt-1 block text-slate-500">Начисляется после создания чека. При возврате уменьшается. 0 — без начислений.</small>
  </label>;
}
