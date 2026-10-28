'use client';

import Link from 'next/link';
import { useState } from 'react';
import { CatalogShell } from '../../../components/catalog-shell';
import { api, type Page } from '../../../lib/api';

type ExistingCustomer = { id: string; phone: string };
type CustomerRow = { line: number; firstName: string; lastName: string; phone: string; email: string; birthday: string; gender: string; address: string; notes: string; status: 'ready' | 'existing' | 'error' | 'done' | 'failed'; message: string };
const expected = ['Имя', 'Фамилия', 'Телефон', 'Email', 'Дата рождения', 'Пол', 'Адрес', 'Заметки'];
const phonePattern = /^\+[1-9]\d{7,14}$/;

export default function CustomerImportPage() {
  const [rows, setRows] = useState<CustomerRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [finished, setFinished] = useState(false);

  async function chooseFile(file?: File) {
    setRows([]); setError(''); setFinished(false);
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.xlsx') || file.size > 5_000_000) { setError('Выберите файл XLSX размером до 5 МБ.'); return; }
    setBusy(true);
    try {
      const { readXlsx } = await import('../../../lib/xlsx');
      const matrix = await readXlsx(await file.arrayBuffer());
      if (matrix.length < 2 || matrix.length > 301) throw new Error('В файле должно быть от 1 до 300 клиентов.');
      if (expected.some((header, index) => matrix[0]?.[index]?.trim() !== header)) throw new Error('Первые восемь колонок должны быть: ' + expected.join(', '));
      const seen = new Set<string>();
      const prepared = matrix.slice(1).map((cells, index): CustomerRow => {
        const [firstName = '', lastName = '', phone = '', email = '', birthday = '', gender = '', address = '', notes = ''] = cells.map(value => value.trim());
        const problems: string[] = [];
        if (!firstName || firstName.length > 100) problems.push('Проверьте имя');
        if (!phonePattern.test(phone)) problems.push('Нужен телефон с кодом страны');
        if (seen.has(phone)) problems.push('Телефон повторяется в файле');
        seen.add(phone);
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) problems.push('Проверьте Email');
        if (birthday && (!/^\d{4}-\d{2}-\d{2}$/.test(birthday) || Number.isNaN(Date.parse(birthday)))) problems.push('Проверьте дату рождения');
        return { line: index + 2, firstName, lastName, phone, email, birthday, gender, address, notes, status: problems.length ? 'error' : 'ready', message: problems.join('; ') };
      });
      const existing = new Set<string>();
      for (let page = 1; ; page++) {
        const result = await api<Page<ExistingCustomer>>(`/customers?page=${page}&limit=100`);
        result.items.forEach(customer => existing.add(customer.phone));
        if (page * 100 >= result.total || !result.items.length) break;
      }
      for (const row of prepared) if (row.status === 'ready' && existing.has(row.phone)) { row.status = 'existing'; row.message = 'Уже есть в ЛК — пропущен'; }
      setRows(prepared);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Не удалось прочитать файл.'); }
    finally { setBusy(false); }
  }

  async function commit() {
    setBusy(true); setError('');
    const updated = [...rows];
    for (let index = 0; index < updated.length; index++) {
      const row = updated[index]!;
      if (row.status !== 'ready') continue;
      try {
        await api('/customers', { method: 'POST', body: JSON.stringify({ firstName: row.firstName, lastName: row.lastName || null, phone: row.phone, email: row.email || null, birthday: row.birthday ? `${row.birthday}T00:00:00.000Z` : null, gender: row.gender || null, address: row.address || null, notes: row.notes || null }) });
        updated[index] = { ...row, status: 'done', message: 'Добавлен' };
      } catch (caught) {
        updated[index] = { ...row, status: 'failed', message: caught instanceof Error ? caught.message : 'Ошибка сохранения' };
      }
      setRows([...updated]);
    }
    setFinished(true); setBusy(false);
  }

  const ready = rows.filter(row => row.status === 'ready').length;
  const done = rows.filter(row => row.status === 'done').length;
  const skipped = rows.filter(row => row.status === 'existing').length;
  const errors = rows.filter(row => row.status === 'error' || row.status === 'failed').length;
  return <CatalogShell><section className="crm-workspace-page crm-import-page space-y-6">
    <div className="crm-page-head"><div><span className="crm-eyebrow">ПОКУПАТЕЛИ</span><h1>Импорт клиентов</h1><p>Загрузите подготовленный XLSX, проверьте записи и добавьте клиентов.</p></div><Link className="crm-outline-button" href="/customers">← К клиентам</Link></div>
    {error && <p className="crm-alert" role="alert">{error}</p>}
    <div className="crm-import-panel"><h2>1. Выберите файл</h2><p>До 300 клиентов за раз. Совпадающие телефоны в ЛК будут пропущены; существующие карточки не меняются.</p><input aria-label="XLSX с клиентами" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={busy} onChange={event => void chooseFile(event.target.files?.[0])} /></div>
    {rows.length > 0 && <div className="crm-import-panel"><h2>2. Проверьте и загрузите</h2><p>К загрузке: {ready} · Уже есть: {skipped} · Ошибки: {errors}{finished ? ` · Добавлено: ${done}` : ''}</p><div className="crm-products-table-wrap"><table className="crm-products-table crm-mobile-cards"><thead><tr><th>Строка</th><th>Клиент</th><th>Телефон</th><th>Результат</th></tr></thead><tbody>{rows.map(row => <tr key={row.line}><td data-label="Строка">{row.line}</td><td data-label="Клиент">{row.firstName} {row.lastName}</td><td data-label="Телефон">{row.phone}</td><td data-label="Результат">{row.message || 'Готов к загрузке'}</td></tr>)}</tbody></table></div>{ready > 0 && <button className="crm-primary-button" disabled={busy} onClick={() => void commit()}>{busy ? 'Добавляем…' : `Добавить ${ready} клиентов`}</button>}{finished && <p role="status">Импорт завершён. Добавлено: {done}. Ошибок: {errors}.</p>}</div>}
  </section></CatalogShell>;
}
