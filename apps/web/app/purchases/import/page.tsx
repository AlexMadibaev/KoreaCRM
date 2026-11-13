'use client';

import { TypedInput, formatCurrencyMinor as money } from '@koreacrm/ui';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { BulkInvoiceProducts } from '../../../components/bulk-invoice-products';
import { ProductForm, type ProductDraft } from '../../../components/product-form';
import { CabinetDrawer } from '../../../components/cabinet-drawer';
import { CatalogShell } from '../../../components/catalog-shell';
import { api, type Page, type Product } from '../../../lib/api';
import { parseCsv } from '../../../lib/csv';
import {
  detectInvoiceHeader,
  detectInvoiceLastRow,
  emptyInvoiceMapping,
  invoiceFields,
  invoiceRows,
  type InvoiceMapping,
} from '../../../lib/invoice';
import { SearchCaption } from "../../../components/search-caption";

type Named = { id: string; name: string };
type Row = ReturnType<typeof invoiceRows>[number] & { productId?: string };
type CatalogueMatch = { line: number; status: 'FOUND' | 'NOT_FOUND' | 'AMBIGUOUS' | 'EXPENSE' | 'EXCLUDED'; product: { id: string; name: string; sku: string } | null };
type Preview = {
  totalMinor: string;
  canConfirm: boolean;
  rows: (Row & {
    product: { id: string; name: string; sku: string } | null;
    issues: string[];
    sourceTotal: string;
    mismatch: boolean;
    totalMinor: string;
  })[];
};
export default function InvoiceImportPage() {
  const [stores, setStores] = useState<Named[]>([]),
    [suppliers, setSuppliers] = useState<Named[]>([]);
  const [storeId, setStoreId] = useState(''),
    [supplierId, setSupplierId] = useState('');
  const [number, setNumber] = useState(''),
    [date, setDate] = useState(''),
    [filename, setFilename] = useState('');
  const [currency, setCurrency] = useState<'' | 'TJS' | 'USD'>(''),
    [rate, setRate] = useState('');
  const [matrix, setMatrix] = useState<string[][]>([]),
    [mapping, setMapping] = useState<InvoiceMapping>(emptyInvoiceMapping);
  const [headerRow, setHeaderRow] = useState(0),
    [lastRow, setLastRow] = useState(0);
  const [rows, setRows] = useState<Row[]>([]),
    [preview, setPreview] = useState<Preview | null>(null);
  const [catalogueResult, setCatalogueResult] = useState<{ source: Row[]; rows: CatalogueMatch[] } | null>(null);
  const [catalogueError, setCatalogueError] = useState('');
  const [checking, setChecking] = useState(false);
  const [validationRevision, setValidationRevision] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [amountChecks, setAmountChecks] = useState<Preview['rows']>([]);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [createdId, setCreatedId] = useState('');
  const [canCreateProduct, setCanCreateProduct] = useState(false);
  const [bulkRows, setBulkRows] = useState<Row[] | null>(null);
  const [productDraft, setProductDraft] = useState<{ row: Row; initial: ProductDraft } | null>(null);
  const [productSaving, setProductSaving] = useState(false);
  const [linkedNotice, setLinkedNotice] = useState('');
  const [lookup, setLookup] = useState(''),
    [matches, setMatches] = useState<Product[]>([]);
  useEffect(() => {
    async function load() {
      const [s, me] = await Promise.all([api<Named[]>('/stores'), api<{ permissions: string[] }>('/auth/me')]);
      setCanCreateProduct(me.permissions.includes('products.create'));
      setStores(s);
      setStoreId(s[0]?.id ?? '');
      const all: Named[] = [];
      for (let page = 1; ; page++) {
        const result = await api<Page<Named>>(
          `/suppliers?limit=100&page=${page}`,
        );
        all.push(...result.items);
        if (all.length >= result.total || !result.items.length) break;
      }
      setSuppliers(all);
    }
    void load().catch((reason) =>
      setError(reason instanceof Error ? reason.message : 'Ошибка загрузки'),
    );
  }, []);
  function invalidate() {
    setPreview(null);
    setCreatedId('');
  }
  async function chooseFile(file?: File) {
    setError('');
    setMatrix([]);
    setAmountChecks([]);
    setShowSettings(false);
    setRows([]);
    invalidate();
    if (!file) return;
    setBusy(true);
    try {
      if (!/\.(csv|xlsx)$/i.test(file.name))
        throw new Error(
          'Поддерживаются CSV и XLSX. Старый XLS сохраните как XLSX. Фото и PDF пока не распознаются.',
        );
      if (file.size > 5_000_000)
        throw new Error('Максимальный размер файла — 5 МБ');
      const bytes = await file.arrayBuffer();
      let data: string[][];
      if (/\.xlsx$/i.test(file.name))
        data = await import('../../../lib/xlsx').then((module) =>
          module.readXlsx(bytes),
        );
      else {
        let text: string;
        try {
          text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        } catch {
          text = new TextDecoder('windows-1251').decode(bytes);
        }
        data = parseCsv(text);
      }
      if (data.length < 2 || data.length > 301)
        throw new Error(
          'Нужны заголовок и строки накладной, не более 301 строки всего',
        );
      const detected = detectInvoiceHeader(data);
      setMatrix(data);
      setMapping(detected.mapping);
      setHeaderRow(detected.row);
      const end = detectInvoiceLastRow(data, detected.mapping, detected.row);
      setLastRow(end);
      try {
        setRows(invoiceRows(data, detected.mapping, detected.row, end));
      } catch (reason) {
        setShowSettings(true);
        setError(`Не удалось автоматически настроить таблицу. Проверьте настройки: ${reason instanceof Error ? reason.message : 'неизвестный формат'}`);
      }
      setFilename(file.name);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Не удалось прочитать файл',
      );
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    setCatalogueError('');
    if (!rows.length || !storeId || createdId) return;
    let current = true;
    const timer = setTimeout(() => {
      void api<CatalogueMatch[]>(`/stores/${storeId}/purchases/import/match`, {
        method: 'POST', body: JSON.stringify({ rows }),
      }).then((result) => {
        if (current) setCatalogueResult({ source: rows, rows: result });
      }).catch((reason) => {
        if (current) setCatalogueError(reason instanceof Error ? reason.message : 'Не удалось проверить каталог');
      });
    }, 250);
    return () => { current = false; clearTimeout(timer); };
  }, [rows, storeId, createdId, validationRevision]);
  const payload = (input: Row[]) => ({
    supplierId,
    number,
    date,
    filename,
    currency,
    exchangeRate: rate,
    rows: input,
  });
  useEffect(() => {
    if (!rows.length || !storeId || !supplierId || !number.trim() || !date || !currency || !rate || createdId) {
      setChecking(false);
      return;
    }
    let current = true;
    const timer = setTimeout(() => {
      setChecking(true);
      void api<Preview>(`/stores/${storeId}/purchases/import/preview`, {
        method: 'POST',
        body: JSON.stringify({ supplierId, number, date, filename, currency, exchangeRate: rate, rows }),
      }).then((result) => {
        if (!current) return;
        setPreview(result);
        setAmountChecks(result.rows);
        setError('');
      }).catch((reason) => {
        if (current) setError(reason instanceof Error ? reason.message : 'Не удалось проверить накладную');
      }).finally(() => {
        if (current) setChecking(false);
      });
    }, 350);
    return () => { current = false; clearTimeout(timer); };
  }, [rows, storeId, supplierId, number, date, filename, currency, rate, createdId, validationRevision]);
  function check(rebuild = false) {
    setError('');
    invalidate();
    try {
      if (rebuild) setRows(invoiceRows(matrix, mapping, headerRow, lastRow));
      else setValidationRevision((value) => value + 1);
      if (!storeId || !supplierId || !number.trim() || !date || !currency || !rate)
        setError('Для автоматической проверки заполните магазин, поставщика, номер, дату, валюту и курс выше.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось прочитать строки');
      setShowSettings(true);
    }
  }
  function editRow(line: number, change: Partial<Row>) {
    setRows((current) =>
      current.map((row) => (row.line === line ? { ...row, ...change } : row)),
    );
    invalidate();
  }
  async function confirm() {
    setBusy(true);
    setError('');
    try {
      const result = await api<{ id: string }>(
        `/stores/${storeId}/purchases/import/confirm`,
        { method: 'POST', body: JSON.stringify(payload(rows)) },
      );
      setCreatedId(result.id);
      setPreview(null);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Не удалось создать закупку',
      );
    } finally {
      setBusy(false);
    }
  }
  async function searchProducts() {
    setBusy(true);
    setError('');
    try {
      setMatches(
        (
          await api<Page<Product>>(
            `/products?limit=100&search=${encodeURIComponent(lookup)}`,
          )
        ).items,
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Ошибка поиска');
    } finally {
      setBusy(false);
    }
  }
  function createFromRow(row: Row) {
    setProductDraft({ row, initial: {
      name: [row.name, row.characteristic].filter(Boolean).join(' '),
      sku: row.sku || row.barcode || `IMPORT-${crypto.randomUUID()}`,
      description: row.characteristic || '',
      unit: 'pcs',
      barcodes: row.barcode ? [row.barcode] : [],
    } });
  }
  const missingRows = catalogueResult?.source === rows
    ? rows.filter((row) => !row.excluded && !row.productId && catalogueResult.rows.some((match) => match.line === row.line && match.status === 'NOT_FOUND'))
    : [];
  const locked = busy || Boolean(createdId);
  return (
    <CatalogShell>
      <div className="crm-screen crm-invoice-import">
        <div className="crm-page-head">
          <div>
            <span className="crm-eyebrow">ПОСТАВКИ</span>
            <h1>Импорт накладной</h1>
            <p>
              Проверьте товары и суммы. После подтверждения появится черновик
              для отдельной приёмки.
            </p>
          </div>
          <div className="crm-page-actions"><Link href="/purchases" className="ks-button ks-button--secondary crm-outline-button">
            К закупкам
          </Link></div>
        </div>
        {error && (
          <p role="alert" className="crm-alert">
            {error}
          </p>
        )}
        {createdId && (
          <p role="status" className="crm-panel p-4">
            Черновик закупки «{number}» создан.{' '}
            <Link className="underline" href="/purchases">
              Откройте закупки для отправки заказа и приёмки.
            </Link>
          </p>
        )}
        <fieldset
          disabled={locked}
          className="crm-panel grid gap-3 p-4 sm:grid-cols-3"
        >
          <legend>1. Реквизиты документа</legend>
          <label>
            Магазин
            <select
              className="block w-full rounded border p-2"
              value={storeId}
              onChange={(e) => {
                setStoreId(e.target.value);
                invalidate();
              }}
            >
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Поставщик
            <select
              className="block w-full rounded border p-2"
              value={supplierId}
              onChange={(e) => {
                setSupplierId(e.target.value);
                invalidate();
              }}
            >
              <option value="">Выберите</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Номер накладной
            <input
              className="block w-full rounded border p-2"
              value={number}
              onChange={(e) => {
                setNumber(e.target.value);
                invalidate();
              }}
            />
          </label>
          <label>
            Дата накладной
            <input
              type="date"
              className="block w-full rounded border p-2"
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                invalidate();
              }}
            />
          </label>
          <label>
            Валюта документа
            <select
              className="block w-full rounded border p-2"
              value={currency}
              onChange={(e) => {
                const value = e.target.value as 'USD' | 'TJS';
                setCurrency(value);
                setRate(value === 'TJS' ? '1' : '');
                invalidate();
              }}
            >
              <option value="">Выберите валюту</option>
              <option value="TJS">TJS — сомони</option>
              <option value="USD">USD — доллар</option>
            </select>
          </label>
          <label>
            Курс TJS за 1 {currency}
            <TypedInput fractionDigits={8}
              inputMode="decimal"
              disabled={currency === 'TJS'}
              className="block w-full rounded border p-2"
              value={rate}
              onChange={(e) => {
                setRate(e.target.value);
                invalidate();
              }}
            />
          </label>
          <label className="sm:col-span-3">
            Накладная CSV или XLSX
            <input
              className="block"
              type="file"
              accept=".csv,.xlsx"
              onChange={(e) => void chooseFile(e.target.files?.[0])}
            />
          </label>
          <p className="sm:col-span-3 text-sm">
            Для USD подтвердите курс этой накладной. Цены в закупке будут
            сохранены в сомони. PDF, фото и старый XLS требуют предварительного
            преобразования.
          </p>
        </fieldset>
        {matrix.length > 0 && (
          <fieldset disabled={locked} className="crm-panel space-y-4 p-4">
            <legend>2. Настройки таблицы</legend>
            <p className="text-sm" role="status">
              {rows.length > 0
                ? `Таблица настроена: ${rows.length} строк товаров. Колонки и границы определены; при необходимости их можно изменить.`
                : 'Проверьте настройки таблицы, затем подготовьте предпросмотр.'}
            </p>
            <details open={showSettings} onToggle={(event) => setShowSettings(event.currentTarget.open)}>
              <summary className="cursor-pointer">Изменить настройки</summary>
              <div className="grid gap-4 pt-4">
            <div className="flex flex-wrap gap-4">
              <label>
                Строка заголовков
                <select
                  className="ml-2 rounded border p-2"
                  value={headerRow}
                  onChange={(e) => {
                    const row = Number(e.target.value);
                    const nextMapping = detectInvoiceHeader([matrix[row] ?? []]).mapping;
                    setHeaderRow(row);
                    setMapping(nextMapping);
                    setLastRow(detectInvoiceLastRow(matrix, nextMapping, row));
                    setRows([]);
                    invalidate();
                  }}
                >
                  {matrix.slice(0, 30).map((cells, index) => (
                    <option key={index} value={index}>
                      {index + 1}:{' '}
                      {[...new Set(cells.filter(Boolean))].join(' · ').slice(0, 100)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Последняя строка товаров
                <TypedInput
                  type="number"
                  min={headerRow + 2}
                  max={matrix.length}
                  className="ml-2 w-24 rounded border p-2"
                  value={lastRow}
                  onChange={(e) => {
                    setLastRow(Number(e.target.value));
                    setRows([]);
                    invalidate();
                  }}
                />
              </label>
            </div>
            <p className="text-sm">
              Проверьте границы: заголовки документа и итоговые строки не должны
              входить в товары. Скидка указывается в процентах.
            </p>
            <div className="grid gap-3 sm:grid-cols-4">
              {invoiceFields.map((field) => (
                <label key={field.key}>
                  {field.label}
                  <select
                    className="block w-full rounded border p-2"
                    value={mapping[field.key]}
                    onChange={(e) => {
                      setMapping({
                        ...mapping,
                        [field.key]: Number(e.target.value),
                      });
                      setRows([]);
                      invalidate();
                    }}
                  >
                    <option value={-1}>Не указана</option>
                    {(matrix[headerRow] ?? []).map((cell, index) => (
                      <option key={index} value={index}>
                        {index + 1}: {cell || 'Без названия'}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
              </div>
            </details>
            <button
              className="ks-button ks-button--primary crm-primary-button"
              onClick={() => void check(true)}
            >
              Проверить товары
            </button>
          </fieldset>
        )}
        {rows.length > 0 && (
          <section className="crm-panel space-y-4 p-4">
            <h2>3. Проверка строк</h2>
            {linkedNotice && <p role="status">{linkedNotice}</p>}
            {canCreateProduct && <button type="button" className="ks-button ks-button--primary" disabled={locked || !missingRows.length} onClick={() => setBulkRows(missingRows)}>Добавить все ненайденные товары ({missingRows.length})</button>}
            <p>
              Совпадения проверяются по штрихкоду, артикулу, затем полному
              названию с характеристикой. Для неизвестного товара создайте карточку прямо в строке накладной. Исключённые расходы сохраняются в исходном документе;
              учтите их отдельно в финансах.
            </p>
            <div className="flex flex-wrap gap-2">
              <label>
                <SearchCaption text="Поиск товара для ручного выбора" /><input
                  disabled={locked}
                  className="ml-2 rounded border p-2"
                  type="search" placeholder="Название или артикул товара" value={lookup}
                  onChange={(e) => setLookup(e.target.value)}
                />
              </label>
              <button
                disabled={locked || !lookup.trim()}
                className="ks-button ks-button--secondary crm-outline-button"
                onClick={() => void searchProducts()}
              >
                Найти
              </button>

            </div>
            <p role="status" className="text-sm">
              {checking ? 'Проверяем суммы и ищем совпадения в каталоге…' : !preview
                ? 'Поиск товаров запускается сразу после загрузки файла. Реквизиты выше нужны для проверки сумм и создания закупки.'
                : 'Проверка завершена. Исправьте отмеченные строки перед созданием закупки.'}
            </p>
            <div className="overflow-x-auto">
              <table className="crm-invoice-lines w-full text-left text-sm">
                <thead>
                  <tr>
                    <th>Строка</th>
                    <th>Товар в накладной</th>
                    <th>Количество / цена</th>
                    <th>Товар каталога</th>
                    <th>Проверка</th>
                    <th>Исключить</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const checked = preview?.rows.find(
                      (item) => item.line === row.line,
                    );
                    const catalogue = catalogueResult?.source === rows ? catalogueResult.rows.find((item) => item.line === row.line) : undefined;
                    const amountCheck = amountChecks.find((item) => item.line === row.line);
                    return (
                      <tr
                        key={row.line}
                        className={`border-t ${checked?.issues.length ? 'bg-amber-50' : ''}`}
                      >
                        <td className="p-2">{row.line}</td>
                        <td className="p-2">
                          {row.name} {row.characteristic}
                          <small className="block">
                            {row.barcode || row.sku}
                          </small>
                        </td>
                        <td className="p-2">
                          {row.quantity} × {row.price} {currency}
                          <small className="block">
                            Скидка: {row.discountPercent}% · сумма:{' '}
                            {row.total ?? 'не указана'}
                          </small>
                        </td>
                        <td className="p-2">
                          <span>
                            {checked?.product?.name ?? catalogue?.product?.name ?? (catalogue?.status === 'NOT_FOUND' ? 'Товар не найден' : catalogue?.status === 'EXPENSE' ? 'Строка расхода' : 'Поиск в каталоге…')}
                          </span>
                          <select
                            disabled={locked || row.excluded || !matches.length}
                            aria-label={`Товар каталога для строки ${row.line}`}
                            className="block max-w-64 rounded border p-2"
                            value={row.productId ?? ''}
                            onChange={(e) =>
                              editRow(row.line, {
                                productId: e.target.value || undefined,
                              })
                            }
                          >
                            <option value="">
                              Автоматическое сопоставление
                            </option>
                            {row.productId &&
                              !matches.some(
                                (product) => product.id === row.productId,
                              ) && (
                                <option value={row.productId}>
                                  Выбран вручную
                                </option>
                              )}
                            {matches.map((product) => (
                              <option key={product.id} value={product.id}>
                                {product.name} ({product.sku})
                              </option>
                            ))}
                          </select>
                          {!matches.length && <small className="block">Для ручного выбора найдите товар через поиск выше.</small>}
                          {canCreateProduct && !row.excluded && !row.productId && catalogue?.status === 'NOT_FOUND' && (
                            <button type="button" disabled={locked} className="ks-button ks-button--secondary ks-button--sm" onClick={() => createFromRow(row)}>
                              Создать карточку
                            </button>
                          )}
                        </td>
                        <td className="p-2">
                          {(amountCheck?.mismatch || row.acceptCalculatedTotal) && !row.excluded && (
                            <label className="block">
                              <input
                                type="checkbox"
                                disabled={locked}
                                checked={row.acceptCalculatedTotal}
                                onChange={(e) => editRow(row.line, { acceptCalculatedTotal: e.target.checked })}
                              />{' '}
                              Подтверждаю расчёт по цене × количеству с учётом скидки
                              {amountCheck ? `: ${amountCheck.sourceTotal} ${currency}` : ''}
                              {' '}(в документе: {row.total} {currency}).
                            </label>
                          )}
                          {checked
                            ? checked.issues.length
                              ? checked.issues.join('; ')
                              : row.excluded
                                ? 'Исключена'
                                : `${money(checked.totalMinor)} сомони`
                            : catalogueError ? catalogueError : !catalogue ? 'Ищем товар в каталоге…' : catalogue.status === 'NOT_FOUND' ? 'Создайте карточку или выберите существующий товар' : catalogue.status === 'AMBIGUOUS' ? 'Несколько совпадений — выберите товар вручную' : catalogue.status === 'EXPENSE' ? 'Исключите расход из товаров' : catalogue.status === 'EXCLUDED' ? 'Исключена' : checking ? 'Проверяем суммы…' : 'Товар найден. Для проверки суммы заполните реквизиты выше'}
                        </td>
                        <td className="p-2">
                          <input
                            type="checkbox"
                            disabled={locked}
                            aria-label={`Исключить строку ${row.line}`}
                            checked={row.excluded}
                            onChange={(e) =>
                              editRow(row.line, { excluded: e.target.checked })
                            }
                          />
                          {row.excluded && (
                            <input
                              disabled={locked}
                              aria-label={`Причина исключения строки ${row.line}`}
                              placeholder="Причина исключения"
                              className="block rounded border p-2"
                              value={row.exclusionReason}
                              onChange={(e) =>
                                editRow(row.line, {
                                  exclusionReason: e.target.value,
                                })
                              }
                            />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <button
              disabled={locked}
              className="ks-button ks-button--secondary crm-outline-button"
              onClick={() => void check()}
            >
              Перепроверить строки
            </button>
            {preview && (
              <p>
                Итого товаров: {money(preview.totalMinor)} сомони. Округление —
                до дирама за единицу после скидки и пересчёта валюты.
              </p>
            )}
            {preview?.canConfirm && (
              <button
                disabled={locked}
                className="ks-button ks-button--primary crm-primary-button"
                onClick={() => void confirm()}
              >
                Подтвердить и создать черновик закупки
              </button>
            )}
          </section>
        )}
      </div>
      {bulkRows && <BulkInvoiceProducts rows={bulkRows} currency={currency} onClose={() => setBulkRows(null)} onCreated={(line, product) => {
        editRow(line, { productId: product.id });
        setMatches((current) => [product, ...current.filter((item) => item.id !== product.id)]);
        setLinkedNotice('Созданные карточки связаны со строками накладной.');
      }} />}
      {productDraft && (
        <CabinetDrawer title="Новый товар из накладной" onClose={() => { if (!productSaving) setProductDraft(null); }}>
          <p className="text-sm">Строка {productDraft.row.line}. Закупочная цена: {productDraft.row.price} {currency} за единицу, скидка {productDraft.row.discountPercent}%. Цена сохранится в закупке; остаток появится после приёмки.</p>
          <ProductForm key={productDraft.row.line} initialDraft={productDraft.initial} onSavingChange={setProductSaving} onSaved={(product) => {
            editRow(productDraft.row.line, { productId: product.id });
            setMatches((current) => [product, ...current.filter((item) => item.id !== product.id)]);
            setLinkedNotice(`Карточка «${product.name}» создана и связана со строкой ${productDraft.row.line}.`);
            setProductDraft(null);
          }} />
        </CabinetDrawer>
      )}
    </CatalogShell>
  );
}
