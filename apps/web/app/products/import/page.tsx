'use client';

import Link from 'next/link';
import { useState } from 'react';
import { api, type Brand, type Category, type Page, type Product } from '../../../lib/api';
import { parseCsv, serializeCsv } from '../../../lib/csv';

type Field = 'sku' | 'name' | 'brand' | 'category' | 'barcode' | 'country' | 'unit' | 'description';
type Mapping = Record<Field, number>;
type ImportRow = { line: number; sku: string; name: string; payload: Record<string, unknown>; existingId?: string; status: 'new' | 'update' | 'error' | 'done' | 'failed'; message?: string };
const fields: { key: Field; label: string; aliases: string[] }[] = [
  { key: 'sku', label: 'Артикул *', aliases: ['sku', 'артикул', 'код товара'] },
  { key: 'name', label: 'Название *', aliases: ['name', 'название', 'наименование', 'товар'] },
  { key: 'brand', label: 'Бренд', aliases: ['brand', 'бренд'] },
  { key: 'category', label: 'Категория', aliases: ['category', 'категория'] },
  { key: 'barcode', label: 'Штрихкод', aliases: ['barcode', 'barcodes', 'штрихкод', 'штрихкоды'] },
  { key: 'country', label: 'Страна', aliases: ['country', 'страна'] },
  { key: 'unit', label: 'Единица', aliases: ['unit', 'единица'] },
  { key: 'description', label: 'Описание', aliases: ['description', 'описание'] },
];
const emptyMapping = Object.fromEntries(fields.map(({ key }) => [key, -1])) as Mapping;

async function allPages<T>(path: string): Promise<T[]> {
  const items: T[] = [];
  for (let page = 1; ; page++) {
    const result = await api<Page<T>>(`${path}?page=${page}&limit=100`);
    items.push(...result.items);
    if (items.length >= result.total || !result.items.length) return items;
  }
}

function matchingId(name: string, records: { id: string; name: string }[]): string | null {
  if (!name) return null;
  return records.find((item) => item.name.localeCompare(name, 'ru', { sensitivity: 'base' }) === 0)?.id ?? null;
}

export default function ProductImportPage() {
  const [matrix, setMatrix] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Mapping>(emptyMapping);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [finished, setFinished] = useState(false);
  const header = matrix[0] ?? [];

  async function chooseFile(file?: File) {
    setRows([]); setFinished(false); setError(''); setMatrix([]);
    if (!file) return;
    const isXlsx = file.name.toLowerCase().endsWith('.xlsx');
    if (!isXlsx && !file.name.toLowerCase().endsWith('.csv')) { setError('Выберите файл CSV или XLSX'); return; }
    if (file.size > (isXlsx ? 5_000_000 : 2_000_000)) { setError('Файл слишком большой. Разделите каталог на части.'); return; }
    try {
      const bytes = await file.arrayBuffer();
      let parsed: string[][];
      if (isXlsx) parsed = await import('../../../lib/xlsx').then(({ readXlsx }) => readXlsx(bytes));
      else {
        let content: string;
        try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
        catch { content = new TextDecoder('windows-1251').decode(bytes); }
        parsed = parseCsv(content);
      }
      if (parsed.length < 2) throw new Error('В файле нет строк с товарами');
      if (parsed.length > 301) throw new Error('За один раз можно загрузить до 300 товаров');
      const columns = parsed[0]!.map((value) => value.trim().toLowerCase());
      const automatic = { ...emptyMapping };
      for (const field of fields) automatic[field.key] = columns.findIndex((value) => field.aliases.includes(value));
      setMatrix(parsed); setMapping(automatic);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Не удалось прочитать файл'); }
  }

  async function preview() {
    if (mapping.sku < 0 || mapping.name < 0) { setError('Сопоставьте колонки «Артикул» и «Название»'); return; }
    const selected = Object.values(mapping).filter((index) => index >= 0);
    if (new Set(selected).size !== selected.length) { setError('Одна колонка назначена нескольким полям'); return; }
    setBusy(true); setError(''); setFinished(false); setRows([]);
    try {
      const [brands, categories] = await Promise.all([allPages<Brand>('/brands'), allPages<Category>('/categories')]);
      const seenSku = new Set<string>();
      const seenBarcode = new Set<string>();
      const prepared: ImportRow[] = matrix.slice(1).map((cells, index) => {
        const value = (field: Field) => mapping[field] < 0 ? '' : (cells[mapping[field]] ?? '').trim();
        const sku = value('sku'); const name = value('name'); const problems: string[] = [];
        if (!sku || !name) problems.push('Нужны артикул и название');
        if (sku.length > 100 || name.length > 255) problems.push('Слишком длинный артикул или название');
        if (seenSku.has(sku.toLowerCase())) problems.push('Повтор артикула в файле');
        seenSku.add(sku.toLowerCase());
        const payload: Record<string, unknown> = { sku, name };
        if (mapping.brand >= 0) { const id = matchingId(value('brand'), brands); if (value('brand') && !id) problems.push(`Бренд «${value('brand')}» не найден`); payload.brandId = id; }
        if (mapping.category >= 0) { const id = matchingId(value('category'), categories); if (value('category') && !id) problems.push(`Категория «${value('category')}» не найдена`); payload.categoryId = id; }
        if (mapping.barcode >= 0) {
          const barcodes = value('barcode').split('|').map((item) => item.trim()).filter(Boolean);
          if (barcodes.length > 30 || barcodes.some((item) => item.length > 120)) problems.push('Слишком много или слишком длинные штрихкоды');
          for (const barcode of barcodes) { if (seenBarcode.has(barcode)) problems.push(`Повтор штрихкода ${barcode} в файле`); seenBarcode.add(barcode); }
          payload.barcodes = barcodes;
        }
        if (mapping.country >= 0) { if (value('country').length > 255) problems.push('Страна длиннее 255 символов'); payload.country = value('country') || null; }
        if (mapping.unit >= 0) { if (value('unit').length > 32) problems.push('Единица длиннее 32 символов'); payload.unit = value('unit') || 'pcs'; }
        if (mapping.description >= 0) { if (value('description').length > 5000) problems.push('Описание длиннее 5000 символов'); payload.description = value('description') || null; }
        return { line: index + 2, sku, name, payload, status: problems.length ? 'error' : 'new', message: problems.join('; ') };
      });
      for (let offset = 0; offset < prepared.length; offset += 8) await Promise.all(prepared.slice(offset, offset + 8).map(async (row) => {
        if (row.status === 'error') return;
        try { const found = await api<Page<Product>>(`/products/lookup/sku/${encodeURIComponent(row.sku)}`); if (found.items[0]) { row.existingId = found.items[0].id; row.status = 'update'; } }
        catch (caught) { row.status = 'error'; row.message = caught instanceof Error ? caught.message : 'Не удалось проверить артикул'; }
      }));
      setRows(prepared);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Не удалось проверить файл'); }
    finally { setBusy(false); }
  }

  async function commit() {
    setBusy(true); setError('');
    const updated = [...rows];
    for (let index = 0; index < updated.length; index++) {
      const row = updated[index]!;
      if (row.status !== 'new' && row.status !== 'update') continue;
      try {
        await api(row.existingId ? `/products/${row.existingId}` : '/products', { method: row.existingId ? 'PATCH' : 'POST', body: JSON.stringify(row.payload) });
        updated[index] = { ...row, status: 'done', message: row.existingId ? 'Обновлён' : 'Создан' };
      } catch (caught) { updated[index] = { ...row, status: 'failed', message: caught instanceof Error ? caught.message : 'Ошибка сохранения' }; }
      setRows([...updated]);
    }
    setFinished(true); setBusy(false);
  }

  async function exportProducts(format: 'csv' | 'xlsx') {
    setBusy(true); setError('');
    try {
      const products = await allPages<Product>('/products');
      const table = [['Артикул', 'Название', 'Бренд', 'Категория', 'Штрихкод', 'Страна', 'Единица', 'Описание'], ...products.map((item) => [item.sku, item.name, item.brand?.name ?? '', item.category?.name ?? '', item.barcodes.map((barcode) => barcode.value).join('|'), item.country ?? '', item.unit, item.description ?? ''])];
      const data = format === 'xlsx' ? await import('../../../lib/xlsx').then(({ writeXlsx }) => writeXlsx(table)) : serializeCsv(table);
      const contentType = format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv;charset=utf-8';
      const url = URL.createObjectURL(new Blob([data], { type: contentType }));
      const link = document.createElement('a'); link.href = url; link.download = `koreacrm-products-${new Date().toISOString().slice(0, 10)}.${format}`; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Не удалось выгрузить товары'); }
    finally { setBusy(false); }
  }

  const counts = { new: rows.filter((row) => row.status === 'new').length, update: rows.filter((row) => row.status === 'update').length, error: rows.filter((row) => row.status === 'error' || row.status === 'failed').length, done: rows.filter((row) => row.status === 'done').length };
  return <section className="crm-import-page">
    <div className="crm-page-head"><div><span className="crm-eyebrow">АССОРТИМЕНТ</span><h1>Импорт и экспорт товаров</h1><p>Загрузите CSV или XLSX, проверьте строки и подтвердите изменения.</p></div><Link className="crm-outline-button" href="/products">← К каталогу</Link></div>
    {error && <div className="crm-alert" role="alert">{error}</div>}
    <div className="crm-import-panel"><h2>1. Выберите файл</h2><p>CSV или XLSX, до 300 товаров за раз. Несколько штрихкодов разделите знаком |. Бренды и категории сначала создайте в каталоге.</p><div className="crm-import-actions"><input aria-label="CSV или XLSX с товарами" type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={busy} onChange={(event) => void chooseFile(event.target.files?.[0])} /><button type="button" className="crm-outline-button" disabled={busy} onClick={() => void exportProducts('csv')}>Выгрузить CSV</button><button type="button" className="crm-outline-button" disabled={busy} onClick={() => void exportProducts('xlsx')}>Выгрузить XLSX</button></div></div>
    {matrix.length > 0 && <div className="crm-import-panel"><h2>2. Сопоставьте колонки</h2><div className="crm-import-mapping">{fields.map((field) => <label key={field.key}>{field.label}<select value={mapping[field.key]} disabled={busy} onChange={(event) => { setMapping({ ...mapping, [field.key]: Number(event.target.value) }); setRows([]); setFinished(false); }}><option value={-1}>Не импортировать</option>{header.map((title, index) => <option key={index} value={index}>{title || `Колонка ${index + 1}`}</option>)}</select></label>)}</div><button className="crm-primary-button" disabled={busy} onClick={() => void preview()}>{busy ? 'Проверяем…' : 'Проверить файл'}</button></div>}
    {rows.length > 0 && <div className="crm-import-panel"><h2>3. Предпросмотр</h2><p>Новых: {counts.new} · Обновлений: {counts.update} · Ошибок: {counts.error}{finished ? ` · Сохранено: ${counts.done}` : ''}</p><div className="crm-products-table-wrap"><table className="crm-products-table"><thead><tr><th>Строка</th><th>Артикул</th><th>Название</th><th>Результат</th></tr></thead><tbody>{rows.map((row) => <tr key={row.line}><td>{row.line}</td><td>{row.sku || '—'}</td><td>{row.name || '—'}</td><td>{row.message || ({ new: 'Новый', update: 'Обновление', error: 'Ошибка', done: 'Сохранено', failed: 'Ошибка' }[row.status])}</td></tr>)}</tbody></table></div>{!finished && counts.new + counts.update > 0 && <button className="crm-primary-button" disabled={busy} onClick={() => void commit()}>{busy ? 'Сохраняем…' : `Подтвердить ${counts.new + counts.update} товаров`}</button>}{finished && <p role="status">Импорт завершён. Сохранено: {counts.done}. Ошибок: {counts.error}.</p>}</div>}
  </section>;
}
