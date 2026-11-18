'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';

type RateRow = { phone: string; percent: '7' | '10' };
type Preview = { preview: string; seven: number; ten: number; unchanged: number; missing: number; applied: boolean };

export function DiscountImport() {
  const [allowed, setAllowed] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [rows, setRows] = useState<RateRow[]>([]);
  const [preview, setPreview] = useState<Preview>();

  useEffect(() => {
    let active = true;
    api<{ permissions: string[] }>('/auth/me').then(({ permissions }) => {
      if (active) setAllowed(['customers.view', 'customers.discount.edit'].every(permission => permissions.includes(permission)));
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  async function send(values: RateRow[], confirmation?: string) {
    return api<Preview>('/customers/discount-import', {
      method: 'POST',
      body: JSON.stringify({ rows: values, preview: confirmation }),
    });
  }

  async function select(file?: File) {
    setRows([]);
    setPreview(undefined);
    setError('');
    if (!file) return;
    setWorking(true);
    try {
      if (!file.name.toLowerCase().endsWith('.csv') || file.size > 150000) throw new Error('Выберите CSV размером до 150 КБ.');
      const [header, ...lines] = (await file.text()).trim().split(/\r?\n/);
      if (header !== 'phone,percent' || !lines.length || lines.length > 5000) throw new Error('Ожидается CSV со столбцами phone,percent и 1–5000 строками.');
      const parsed = lines.map((line, index): RateRow => {
        const match = /^(\+[1-9]\d{7,14}),(7|10)$/.exec(line);
        if (!match) throw new Error(`Проверьте телефон и процент в строке ${index + 2}.`);
        return { phone: match[1]!, percent: match[2] === '7' ? '7' : '10' };
      });
      setPreview(await send(parsed));
      setRows(parsed);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось сверить скидки.');
    } finally {
      setWorking(false);
    }
  }

  async function apply() {
    if (!preview || preview.applied || working) return;
    setWorking(true);
    setError('');
    try {
      setPreview(await send(rows, preview.preview));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось обновить скидки.');
      setPreview(undefined);
    } finally {
      setWorking(false);
    }
  }

  if (!allowed) return null;
  return <div className="crm-import-panel space-y-3">
    <h2>Перенос скидок из CloudShop</h2>
    <p>Загрузите подготовленный CSV с телефонами и скидками. Сверка ищет существующие карточки по телефону.</p>
    <input aria-label="CSV со скидками" type="file" accept=".csv,text/csv" disabled={working} onChange={event => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = '';
      void select(file);
    }} />
    {working && <p role="status">Обрабатываем скидки…</p>}
    {error && <p role="alert" className="crm-alert">{error}</p>}
    {preview && <div className="space-y-2" aria-live="polite">
      <p>{preview.applied ? 'Обновлено' : 'К обновлению'}: 7% — {preview.seven}, 10% — {preview.ten}. Уже совпадают: {preview.unchanged}. Телефон не найден: {preview.missing}.</p>
      {!preview.applied && preview.seven + preview.ten > 0 && <button className="ks-button ks-button--primary" type="button" disabled={working} onClick={() => void apply()}>
        Обновить скидки у {preview.seven + preview.ten} клиентов
      </button>}
    </div>}
  </div>;
}
