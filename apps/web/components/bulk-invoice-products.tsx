'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, type Product } from '../lib/api';
import { TypedInput } from '@koreacrm/ui';

type Source = { line: number; name: string; characteristic: string; sku: string; barcode: string; price: string; discountPercent: string };
type Draft = Source & { selected: boolean; unit: string; error: string; created: boolean };
export function BulkInvoiceProducts({ rows, currency, onCreated, onClose }: { rows: Source[]; currency: string; onCreated: (line: number, product: Product) => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const submitting = useRef(false);
  const closeRef = useRef(onClose);
  const [success, setSuccess] = useState(false);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    if (!success) return;
    const timer = setTimeout(() => closeRef.current(), 2000);
    return () => clearTimeout(timer);
  }, [success]);
  const [items, setItems] = useState<Draft[]>(() => rows.map((row) => ({ ...row, name: [row.name, row.characteristic].filter(Boolean).join(' '), sku: row.sku || row.barcode || `IMPORT-${crypto.randomUUID()}`, unit: 'pcs', selected: true, error: '', created: false })));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const element = dialog.current;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    element?.showModal();
    return () => { element?.close(); document.body.style.overflow = previous; };
  }, []);
  function edit(line: number, patch: Partial<Draft>) {
    setItems((current) => current.map((item) => item.line === line ? { ...item, ...patch, error: '' } : item));
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current || success) return;
    const pending = items.filter((item) => item.selected && !item.created);
    if (!pending.length) return;
    const skus = new Set<string>(), barcodes = new Set<string>();
    for (const item of pending) {
      const sku = item.sku.trim().toLocaleLowerCase('ru');
      const barcode = item.barcode.trim();
      if (!item.name.trim() || item.name.trim().length > 255 || !sku || item.sku.trim().length > 100 || barcode.length > 120 || !item.unit.trim() || item.unit.trim().length > 32) {
        setError(`Строка ${item.line}: проверьте название (до 255), артикул (до 100), штрихкод (до 120) и единицу (до 32 символов).`); return;
      }
      if (skus.has(sku) || (barcode && barcodes.has(barcode))) {
        setError(`Строка ${item.line}: артикул или штрихкод повторяется в выбранных товарах. Исправьте данные или снимите лишнюю позицию.`); return;
      }
      skus.add(sku); if (barcode) barcodes.add(barcode);
    }
    submitting.current = true; setSaving(true); setError('');
    let failed = false;
    try {
      for (const item of pending) {
        try {
          const product = await api<Product>('/products', { method: 'POST', body: JSON.stringify({ name: item.name.trim(), sku: item.sku.trim(), unit: item.unit.trim(), description: item.characteristic || null, barcodes: item.barcode.trim() ? [item.barcode.trim()] : [], status: 'ACTIVE' }) });
          onCreated(item.line, product);
          edit(item.line, { created: true });
        } catch (reason) {
          failed = true;
          edit(item.line, { error: reason instanceof Error ? reason.message : 'Не удалось создать карточку' });
        }
      }
      if (!failed) setSuccess(true);
    } finally { submitting.current = false; setSaving(false); }
  }
  const pending = items.filter((item) => item.selected && !item.created).length;
  const completed = items.filter((item) => item.created).length;
  return <dialog ref={dialog} className={`crm-bulk-products-dialog${success ? " is-success" : ""}`} aria-labelledby="bulk-products-title" onCancel={(event) => { event.preventDefault(); if (!submitting.current && !success) onClose(); }}>
    {success ? <div className="crm-bulk-products-success" role="status" aria-live="polite">
      <span className="crm-bulk-products-success-icon" aria-hidden="true">✓</span>
      <h2 id="bulk-products-title">Успешно добавлены</h2>
    </div> : <form onSubmit={submit}>
      <header className="crm-bulk-products-header"><div><h2 id="bulk-products-title">Добавить ненайденные товары</h2><p>Проверьте карточки перед созданием. Снимите отметки с лишних позиций.</p></div><button type="button" className="ks-button ks-button--secondary" disabled={saving} onClick={onClose}>Закрыть</button></header>
      <p>Закупочные цены остаются в накладной. Остатки появятся после приёмки.</p>
      {error && <p role="alert" className="crm-alert">{error}</p>}
      <div className="overflow-x-auto"><table className="crm-bulk-products-table"><thead><tr><th>Добавить</th><th>Название</th><th>Артикул</th><th>Штрихкод</th><th>Единица</th><th>Закупочная цена</th><th>Результат</th></tr></thead><tbody>{items.map((item) => <tr key={item.line}>
        <td><input type="checkbox" aria-label={`Добавить строку ${item.line}`} checked={item.selected} disabled={saving || item.created} onChange={(event) => edit(item.line, { selected: event.target.checked })} /><small>Строка {item.line}</small></td>
        <td><input aria-label={`Название строки ${item.line}`} maxLength={255} value={item.name} disabled={saving || item.created} onChange={(event) => edit(item.line, { name: event.target.value })} /></td>
        <td><input aria-label={`Артикул строки ${item.line}`} maxLength={100} value={item.sku} disabled={saving || item.created} onChange={(event) => edit(item.line, { sku: event.target.value })} /></td>
        <td><TypedInput aria-label={`Штрихкод строки ${item.line}`} inputMode="numeric" pattern=".*" maxLength={120} value={item.barcode} disabled={saving || item.created} onChange={(event) => edit(item.line, { barcode: event.target.value })} /></td>
        <td><input aria-label={`Единица строки ${item.line}`} maxLength={32} value={item.unit} disabled={saving || item.created} onChange={(event) => edit(item.line, { unit: event.target.value })} /></td>
        <td>{item.price} {currency}<small>Скидка {item.discountPercent}%</small></td>
        <td>{item.created ? 'Создан и связан' : item.error ? <span role="alert">{item.error}</span> : 'Готов к созданию'}</td>
      </tr>)}</tbody></table></div>
      <footer className="crm-bulk-products-footer"><p role="status">Создано: {completed} из {items.length}. Выбрано к созданию: {pending}.</p><button type="submit" className="ks-button ks-button--primary" disabled={saving || !pending}>{saving ? 'Создание карточек…' : `Создать выбранные (${pending})`}</button></footer>
    </form>}
  </dialog>;
}
