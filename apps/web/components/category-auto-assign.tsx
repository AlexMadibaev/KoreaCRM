'use client';

import { useState } from 'react';
import { api } from '../lib/api';

type Summary = { total: number; matched: number; applied: boolean; groups: { name: string; count: number; examples: string[] }[] };

export function CategoryAutoAssign({ onApplied }: { onApplied: () => void }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (apply: boolean) => {
    setBusy(true); setError('');
    try {
      const result = await api<Summary>('/categories/auto-assign', apply ? { method: 'POST' } : {});
      setSummary(result);
      if (result.applied) onApplied();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Не удалось распределить товары'); }
    finally { setBusy(false); }
  };
  return <div className="crm-auto-categories-bar">
    <button type="button" className="crm-outline-button" disabled={busy} onClick={() => void run(false)}>{busy && !summary ? 'Проверка…' : 'Распределить по категориям'}</button>
    {(summary || error) && <div className="crm-panel crm-auto-categories">
      {error && <div className="crm-alert">{error}</div>}
      {summary && (summary.applied
        ? <p>Готово: {summary.matched} товаров распределены по категориям. {summary.total - summary.matched ? `Без категории осталось ${summary.total - summary.matched} — их можно указать вручную.` : ''} Касса обновит категории при следующей синхронизации.</p>
        : summary.total === 0
          ? <p>Все товары уже имеют категорию.</p>
          : <>
            <p>Товаров без категории: {summary.total}. По названию распознано {summary.matched}, ещё {summary.total - summary.matched} останутся без категории. Уже назначенные категории не меняются.</p>
            <ul>{summary.groups.map(group => <li key={group.name}><strong>{group.name}</strong> — {group.count}<small>{group.examples.join(' · ')}</small></li>)}</ul>
          </>)}
      <div className="crm-auto-categories-actions">
        {summary && !summary.applied && summary.matched > 0 && <button type="button" className="crm-primary-button" disabled={busy} onClick={() => void run(true)}>{busy ? 'Применение…' : `Применить к ${summary.matched} товарам`}</button>}
        <button type="button" className="crm-outline-button" disabled={busy} onClick={() => { setSummary(null); setError(''); }}>Закрыть</button>
      </div>
    </div>}
  </div>;
}
