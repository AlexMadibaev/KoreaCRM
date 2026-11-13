'use client';

import { TypedInput, formatCurrencyMinor as money, MoneyInput } from '@koreacrm/ui';
import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  ClipboardList,
  History,
  Package,
  Plus,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import { CatalogShell } from '../../components/catalog-shell';
import { CabinetDrawer } from '../../components/cabinet-drawer';
import { api, type Page } from '../../lib/api';

type Named = { id: string; name: string };
type Product = Named & { sku: string };
type Item = {
  id: string;
  quantityOrdered: number;
  quantityReceived: number;
  purchasePriceMinor: string;
  product: Product;
};
type SourceDocument = {
  filename: string;
  date: string;
  currency: string;
  exchangeRate: string;
  rows: {
    line: number;
    name: string;
    characteristic: string;
    quantity: number;
    price: string;
    discountPercent: string;
    excluded: boolean;
    exclusionReason: string;
  }[];
};
type Purchase = {
  sourceDocument?: SourceDocument | null;
  id: string;
  number: string;
  status: string;
  totalMinor: string;
  receivedMinor: string;
  debtMinor: string;
  supplier: Named;
  items: Item[];
  _count?: { items: number };
};
type DraftLine = { product: Product; quantity: number; price: string };
const purchaseStatus: Record<string, string> = {
  DRAFT: 'Черновик',
  ORDERED: 'Ожидает приёмки',
  PARTIALLY_RECEIVED: 'Принята частично',
  RECEIVED: 'Принята',
  CANCELLED: 'Отменена',
};
const statusClass = (status: string) =>
  status === 'RECEIVED'
    ? 'on'
    : status === 'ORDERED' || status === 'PARTIALLY_RECEIVED'
      ? 'pending'
      : 'off';
export default function PurchasesPage() {
  const [stores, setStores] = useState<Named[]>([]),
    [storeId, setStoreId] = useState(''),
    [suppliers, setSuppliers] = useState<Named[]>([]);
  const [permissions, setPermissions] = useState<string[]>([]),
    [purchases, setPurchases] = useState<Page<Purchase> | null>(null);
  const [search, setSearch] = useState(''),
    [appliedSearch, setAppliedSearch] = useState(''),
    [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [opening, setOpening] = useState('');
  const [error, setError] = useState(''),
    [formError, setFormError] = useState(''),
    [message, setMessage] = useState('');
  const [showCreate, setShowCreate] = useState(false),
    [selected, setSelected] = useState<Purchase | null>(null),
    [cancelPending, setCancelPending] = useState(false);
  const [number, setNumber] = useState(''),
    [supplierId, setSupplierId] = useState(''),
    [lines, setLines] = useState<DraftLine[]>([]);
  const [productSearch, setProductSearch] = useState(''),
    [products, setProducts] = useState<Product[]>([]),
    [productsLoading, setProductsLoading] = useState(false);
  const [receiptItemId, setReceiptItemId] = useState(''),
    [receiptQuantity, setReceiptQuantity] = useState('1'),
    [batchNumber, setBatchNumber] = useState('');
  const [manufacturedAt, setManufacturedAt] = useState(''),
    [expiresAt, setExpiresAt] = useState('');
  const version = useRef(0),
    receiptAttempt = useRef<{ fingerprint: string; id: string } | null>(null);
  useEffect(() => {
    Promise.all([
      api<Named[]>('/stores'),
      api<{ permissions: string[] }>('/auth/me'),
    ])
      .then(([items, me]) => {
        setStores(items);
        setStoreId(items[0]?.id ?? '');
        setPermissions(me.permissions);
        if (!items.length) setLoading(false);
      })
      .catch((reason) => {
        setError(reason instanceof Error ? reason.message : 'Ошибка загрузки');
        setLoading(false);
      });
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => {
      setAppliedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);
  const load = useCallback(async () => {
    if (!storeId) return;
    const current = ++version.current;
    setLoading(true);
    setError('');
    try {
      const result = await api<Page<Purchase>>(
        `/stores/${storeId}/purchases?limit=30&page=${page}&search=${encodeURIComponent(appliedSearch)}`,
      );
      if (current === version.current) setPurchases(result);
    } catch (reason) {
      if (current === version.current)
        setError(
          reason instanceof Error
            ? reason.message
            : 'Не удалось загрузить закупки',
        );
    } finally {
      if (current === version.current) setLoading(false);
    }
  }, [storeId, page, appliedSearch]);
  useEffect(() => {
    void load();
    return () => {
      version.current++;
    };
  }, [load]);
  useEffect(() => {
    if (!showCreate) return;
    let active = true;
    async function loadSuppliers() {
      const all: Named[] = [];
      for (let page = 1; ; page++) {
        const result = await api<Page<Named & { status: string }>>(
          `/suppliers?limit=100&page=${page}`,
        );
        all.push(...result.items.filter((item) => item.status === 'ACTIVE'));
        if (page * result.limit >= result.total || !result.items.length) break;
      }
      if (active) setSuppliers(all);
    }
    void loadSuppliers().catch((reason) => {
      if (active)
        setFormError(
          reason instanceof Error
            ? reason.message
            : 'Ошибка загрузки поставщиков',
        );
    });
    return () => {
      active = false;
    };
  }, [showCreate]);
  useEffect(() => {
    if (!showCreate) return;
    let active = true;
    setProductsLoading(true);
    const timer = setTimeout(() => {
      api<Page<Product>>(
        `/products?limit=20&search=${encodeURIComponent(productSearch.trim())}`,
      )
        .then((result) => {
          if (active) setProducts(result.items);
        })
        .catch((reason) => {
          if (active)
            setFormError(
              reason instanceof Error
                ? reason.message
                : 'Ошибка поиска товаров',
            );
        })
        .finally(() => {
          if (active) setProductsLoading(false);
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [showCreate, productSearch]);
  function resetReceipt(purchase: Purchase) {
    setReceiptItemId(
      purchase.items.find(
        (item) => item.quantityReceived < item.quantityOrdered,
      )?.id ?? '',
    );
    setReceiptQuantity('1');
    setBatchNumber('');
    setManufacturedAt('');
    setExpiresAt('');
    receiptAttempt.current = null;
  }
  async function open(purchase: Purchase) {
    setOpening(purchase.id);
    setMessage('');
    setError('');
    setFormError('');
    setCancelPending(false);
    try {
      const item = await api<Purchase>(
        `/stores/${storeId}/purchases/${purchase.id}`,
      );
      resetReceipt(item);
      setSelected(item);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Ошибка загрузки закупки',
      );
    } finally {
      setOpening('');
    }
  }
  function addProduct(product: Product) {
    setLines((current) =>
      current.some((line) => line.product.id === product.id)
        ? current.map((line) =>
            line.product.id === product.id
              ? { ...line, quantity: line.quantity + 1 }
              : line,
          )
        : [...current, { product, quantity: 1, price: '0' }],
    );
  }
  async function create(event: FormEvent) {
    event.preventDefault();
    if (!lines.length) {
      setFormError('Добавьте хотя бы один товар.');
      return;
    }
    if (!number.trim() || !supplierId) {
      setFormError('Укажите номер закупки и поставщика.');
      return;
    }
    if (
      lines.some(
        (line) =>
          !Number.isSafeInteger(line.quantity) ||
          line.quantity < 1 ||
          line.quantity > 2147483647 ||
          !/^\d{1,18}$/.test(line.price),
      )
    ) {
      setFormError(
        'Проверьте позиции: количество должно быть целым положительным числом, цена — корректной суммой.',
      );
      return;
    }
    if (
      lines.reduce(
        (sum, line) => sum + BigInt(line.price) * BigInt(line.quantity),
        0n,
      ) > 999999999999999999n
    ) {
      setFormError(
        'Общая сумма закупки слишком велика. Разделите её на несколько документов.',
      );
      return;
    }
    setBusy(true);
    setFormError('');
    try {
      const purchase = await api<Purchase>(`/stores/${storeId}/purchases`, {
        method: 'POST',
        body: JSON.stringify({
          number: number.trim(),
          supplierId,
          items: lines.map((line) => ({
            productId: line.product.id,
            quantityOrdered: line.quantity,
            purchasePriceMinor: line.price,
          })),
        }),
      });
      setShowCreate(false);
      setNumber('');
      setSupplierId('');
      setLines([]);
      setProductSearch('');
      resetReceipt(purchase);
      setSelected(purchase);
      setMessage(
        'Черновик создан. Проверьте позиции и отправьте заказ, когда будете готовы.',
      );
      await load();
    } catch (reason) {
      setFormError(
        reason instanceof Error ? reason.message : 'Не удалось создать закупку',
      );
    } finally {
      setBusy(false);
    }
  }
  async function action(verb: 'submit' | 'cancel') {
    if (!selected) return;
    setBusy(true);
    setFormError('');
    try {
      const item = await api<Purchase>(
        `/stores/${storeId}/purchases/${selected.id}/${verb}`,
        { method: 'POST' },
      );
      setSelected(item);
      resetReceipt(item);
      setCancelPending(false);
      setMessage(
        verb === 'submit'
          ? 'Заказ отправлен. Теперь можно принять товары.'
          : 'Закупка отменена.',
      );
      await load();
    } catch (reason) {
      setFormError(
        reason instanceof Error ? reason.message : 'Ошибка изменения статуса',
      );
    } finally {
      setBusy(false);
    }
  }
  async function receive(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true);
    setFormError('');
    const items = [
      {
        purchaseItemId: receiptItemId,
        quantity: Number(receiptQuantity),
        batchNumber: batchNumber.trim(),
        manufacturedAt: manufacturedAt || null,
        expiresAt: expiresAt || null,
      },
    ];
    const fingerprint = JSON.stringify({ purchaseId: selected.id, items });
    if (receiptAttempt.current?.fingerprint !== fingerprint)
      receiptAttempt.current = { fingerprint, id: crypto.randomUUID() };
    try {
      await api(`/stores/${storeId}/purchases/${selected.id}/receivings`, {
        method: 'POST',
        body: JSON.stringify({ operationId: receiptAttempt.current.id, items }),
      });
      const purchase = await api<Purchase>(
        `/stores/${storeId}/purchases/${selected.id}`,
      );
      setSelected(purchase);
      resetReceipt(purchase);
      setMessage('Приёмка сохранена, остатки обновлены.');
      await load();
    } catch (reason) {
      setFormError(
        reason instanceof Error ? reason.message : 'Не удалось принять товар',
      );
    } finally {
      setBusy(false);
    }
  }
  const draftTotal = lines
    .reduce(
      (sum, line) =>
        sum + BigInt(line.price || '0') * BigInt(line.quantity || 0),
      0n,
    )
    .toString();
  const receiptItem = selected?.items.find((item) => item.id === receiptItemId);
  const remaining = receiptItem
    ? receiptItem.quantityOrdered - receiptItem.quantityReceived
    : 0;
  return (
    <CatalogShell>
      <div className="crm-screen crm-purchases-page crm-workspace-page">
        <header className="crm-workspace-heading">
          <div>
            <h1>Закупки</h1>
            <p>Заказы поставщикам, приёмка товаров и история поставок.</p>
          </div>
          <div className="crm-workspace-actions">
            <Link href="/purchases/history" className="ks-button ks-button--secondary crm-outline-button">
              <History size={16} aria-hidden />
              История цен
            </Link>
            {permissions.includes('purchases.create') && (
              <>
                <Link href="/purchases/import" className="ks-button ks-button--secondary crm-outline-button">
                  <Upload size={16} aria-hidden />
                  Импорт накладной
                </Link>
                <button
                  disabled={!storeId}
                  className="ks-button ks-button--primary crm-primary-button"
                  onClick={() => {
                    setFormError('');
                    setMessage('');
                    setShowCreate(true);
                  }}
                >
                  <Plus size={17} aria-hidden />
                  Новая закупка
                </button>
              </>
            )}
          </div>
        </header>
        {error && (
          <div className="crm-alert" role="alert">
            {error}
            <button className="ks-button ks-button--ghost ks-button--sm crm-text-action" onClick={() => void load()}>
              Повторить
            </button>
          </div>
        )}
        {message && !selected && (
          <p role="status" className="crm-workspace-notice">
            {message}
          </p>
        )}
        <div className="crm-purchase-filters">
          <label>
            Магазин
            <select
              disabled={busy || Boolean(opening)}
              value={storeId}
              onChange={(event) => {
                setStoreId(event.target.value);
                setPage(1);
                setPurchases(null);
                setMessage('');
              }}
            >
              {stores.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name}
                </option>
              ))}
            </select>
          </label>
          <label className="crm-catalog-search">
            <span>Поиск</span>
            <div>
              <Search size={18} aria-hidden />
              <input
                type="search"
                placeholder="Номер закупки или поставщик"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
          </label>
        </div>
        <section className="crm-list-panel">
          <div className="crm-list-panel-heading">
            <div>
              <h2>
                Все закупки <span>{purchases?.total ?? '—'}</span>
              </h2>
              <p>
                Откройте закупку, чтобы проверить позиции или принять поставку.
              </p>
            </div>
            {loading && (
              <span role="status" className="crm-field-note">
                Обновляем…
              </span>
            )}
          </div>
          <div className="crm-purchase-table-scroll" aria-busy={loading}>
            <table className="crm-purchase-table crm-mobile-cards">
              <thead>
                <tr>
                  <th scope="col">Закупка</th>
                  <th scope="col">Поставщик</th>
                  <th scope="col">Статус</th>
                  <th scope="col" className="num">
                    Сумма, сомони
                  </th>
                  <th scope="col" className="num">
                    Принято, сомони
                  </th>
                  <th scope="col">
                    <span className="sr-only">Действия</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {purchases?.items.map((purchase) => (
                  <tr key={purchase.id}>
                    <td>
                      <strong>№ {purchase.number}</strong>
                      <small className="crm-field-note">
                        Позиций:{' '}
                        {purchase._count?.items ?? purchase.items?.length ?? 0}
                      </small>
                    </td>
                    <td data-label="Поставщик">{purchase.supplier.name}</td>
                    <td data-label="Статус">
                      <span
                        className={`crm-status-pill ${statusClass(purchase.status)}`}
                      >
                        {purchaseStatus[purchase.status] ?? purchase.status}
                      </span>
                    </td>
                    <td data-label="Сумма, сомони" className="num">
                      <strong>{money(purchase.totalMinor)}</strong>
                    </td>
                    <td data-label="Принято, сомони" className="num">
                      {money(purchase.receivedMinor)}
                    </td>
                    <td>
                      <button
                        disabled={Boolean(opening)}
                        className="ks-button ks-button--ghost ks-button--sm crm-text-action"
                        onClick={() => void open(purchase)}
                        aria-label={`Открыть закупку ${purchase.number}`}
                      >
                        {opening === purchase.id ? 'Открываем…' : 'Открыть'}
                        <ArrowRight size={15} aria-hidden />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!loading && !purchases?.items.length && (
              <div className="crm-workspace-empty">
                <ClipboardList size={34} aria-hidden />
                <h3>
                  {search
                    ? 'Закупки не найдены'
                    : 'Здесь будут закупки магазина'}
                </h3>
                <p>
                  {search
                    ? 'Попробуйте другой номер или название поставщика.'
                    : 'Создайте заказ вручную или загрузите накладную. Остатки изменятся после приёмки.'}
                </p>
                {search ? (
                  <button
                    className="ks-button ks-button--secondary crm-outline-button"
                    onClick={() => setSearch('')}
                  >
                    Очистить поиск
                  </button>
                ) : (
                  permissions.includes('purchases.create') && (
                    <button
                      disabled={!storeId}
                      className="ks-button ks-button--primary crm-primary-button"
                      onClick={() => {
                        setFormError('');
                        setShowCreate(true);
                      }}
                    >
                      <Plus size={16} aria-hidden />
                      Создать первую закупку
                    </button>
                  )
                )}
              </div>
            )}
          </div>
          <footer className="crm-list-footer">
            <span>
              {purchases?.total
                ? `${(page - 1) * 30 + 1}–${Math.min(page * 30, purchases.total)} из ${purchases.total}`
                : '0 закупок'}
            </span>
            {purchases && purchases.total > purchases.limit && (
              <div>
                <button
                  className="ks-button ks-button--secondary crm-outline-button"
                  disabled={loading || page === 1}
                  onClick={() => setPage((value) => value - 1)}
                >
                  Назад
                </button>
                <span>
                  {page} / {Math.ceil(purchases.total / purchases.limit)}
                </span>
                <button
                  className="ks-button ks-button--secondary crm-outline-button"
                  disabled={
                    loading || page * purchases.limit >= purchases.total
                  }
                  onClick={() => setPage((value) => value + 1)}
                >
                  Далее
                </button>
              </div>
            )}
          </footer>
        </section>
        {showCreate && (
          <CabinetDrawer
            title="Новая закупка"
            onClose={() => {
              if (!busy) {
                setShowCreate(false);
                setFormError('');
              }
            }}
          >
            <form onSubmit={create} className="crm-purchase-editor">
              <p className="crm-field-note">
                {stores.find((store) => store.id === storeId)?.name} · Сначала
                сохраним черновик, затем можно отправить заказ.
              </p>
              <fieldset disabled={busy}>
                <div className="crm-editor-grid">
                  <label>
                    Номер закупки
                    <input
                      required
                      autoFocus
                      maxLength={255}
                      placeholder="Например, НК-00125"
                      value={number}
                      onChange={(event) => setNumber(event.target.value)}
                    />
                  </label>
                  <label>
                    Поставщик
                    <select
                      required
                      value={supplierId}
                      onChange={(event) => setSupplierId(event.target.value)}
                    >
                      <option value="">Выберите поставщика</option>
                      {suppliers.map((supplier) => (
                        <option key={supplier.id} value={supplier.id}>
                          {supplier.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <section className="crm-editor-section">
                  <div className="crm-section-heading">
                    <h3>Товары</h3>
                    <span className="crm-field-note">
                      {lines.length} позиций
                    </span>
                  </div>
                  <label>
                    Найти и добавить товар
                    <input
                      type="search"
                      placeholder="Название, артикул или штрихкод"
                      value={productSearch}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') event.preventDefault();
                      }}
                      onChange={(event) => setProductSearch(event.target.value)}
                    />
                  </label>
                  <div
                    className="crm-purchase-product-results"
                    aria-busy={productsLoading}
                  >
                    {productsLoading ? (
                      <p role="status">Поиск товаров…</p>
                    ) : products.length ? (
                      products.map((product) => (
                        <button className="ks-button ks-button--secondary"
                          type="button"
                          key={product.id}
                          onClick={() => addProduct(product)}
                        >
                          <span>
                            <strong>{product.name}</strong>
                            <small>{product.sku}</small>
                          </span>
                          <span>
                            {lines.some(
                              (line) => line.product.id === product.id,
                            )
                              ? 'Ещё +1'
                              : 'Добавить'}
                            <Plus size={15} aria-hidden />
                          </span>
                        </button>
                      ))
                    ) : (
                      <p>
                        Товары не найдены.{' '}
                        <Link href="/products/new" target="_blank">
                          Создать товар
                        </Link>
                      </p>
                    )}
                  </div>
                  {!lines.length && (
                    <p className="crm-editor-placeholder">
                      <Package size={20} aria-hidden />
                      Добавьте товары из списка выше.
                    </p>
                  )}
                  <div className="crm-purchase-lines">
                    {lines.map((line) => (
                      <div className="crm-purchase-line" key={line.product.id}>
                        <div className="crm-purchase-line-title">
                          <strong>{line.product.name}</strong>
                          <small>{line.product.sku}</small>
                        </div>
                        <label>
                          Количество
                          <TypedInput
                            required
                            type="number"
                            min={1}
                            max={2147483647}
                            step={1}
                            value={line.quantity}
                            onChange={(event) => {
                              const quantity = Number(event.target.value);
                              setLines((current) =>
                                current.map((item) =>
                                  item.product.id === line.product.id
                                    ? {
                                        ...item,
                                        quantity:
                                          Number.isSafeInteger(quantity) &&
                                          quantity >= 0
                                            ? quantity
                                            : 0,
                                      }
                                    : item,
                                ),
                              );
                            }}
                          />
                        </label>
                        <label>
                          Цена, сомони
                          <MoneyInput
                            required
                            valueMinor={line.price}
                            onMinorChange={(price) =>
                              setLines((current) =>
                                current.map((item) =>
                                  item.product.id === line.product.id
                                    ? { ...item, price }
                                    : item,
                                ),
                              )
                            }
                          />
                        </label>
                        <div className="crm-line-total">
                          <span>Сумма</span>
                          <strong>
                            {money(
                              (
                                BigInt(line.price || '0') *
                                BigInt(line.quantity || 0)
                              ).toString(),
                            )}
                          </strong>
                        </div>
                        <button
                          type="button"
                          className="ks-button ks-button--ghost ks-button--icon crm-icon-button"
                          aria-label={`Убрать ${line.product.name}`}
                          onClick={() =>
                            setLines((current) =>
                              current.filter(
                                (item) => item.product.id !== line.product.id,
                              ),
                            )
                          }
                        >
                          <Trash2 size={17} aria-hidden />
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
                {formError && (
                  <p className="crm-alert" role="alert">
                    {formError}
                  </p>
                )}
                <footer className="crm-editor-footer">
                  <div>
                    <span>Итого, сомони</span>
                    <strong>{money(draftTotal)}</strong>
                  </div>
                  <button
                    disabled={!lines.length || !supplierId}
                    className="ks-button ks-button--primary crm-primary-button"
                    type="submit"
                  >
                    {busy ? 'Сохраняем…' : 'Создать черновик'}
                  </button>
                </footer>
              </fieldset>
            </form>
          </CabinetDrawer>
        )}
        {selected && (
          <CabinetDrawer
            title={`Закупка № ${selected.number}`}
            onClose={() => {
              if (!busy) {
                setSelected(null);
                setCancelPending(false);
                setFormError('');
              }
            }}
          >
            <div className="crm-purchase-editor">
              <div className="crm-purchase-detail-heading">
                <div>
                  <span className="crm-field-note">Поставщик</span>
                  <h3>{selected.supplier.name}</h3>
                </div>
                <span
                  className={`crm-status-pill ${statusClass(selected.status)}`}
                >
                  {purchaseStatus[selected.status] ?? selected.status}
                </span>
              </div>
              {message && (
                <p role="status" className="crm-workspace-notice">
                  <Check size={17} aria-hidden />
                  {message}
                </p>
              )}
              <div className="crm-purchase-summary">
                {[
                  ['Сумма закупки', selected.totalMinor],
                  ['Принято', selected.receivedMinor],
                  ['Долг поставщику', selected.debtMinor],
                ].map(([label, value]) => (
                  <div key={label}>
                    <span>{label}, сомони</span>
                    <strong>{money(value)}</strong>
                  </div>
                ))}
              </div>
              <section className="crm-editor-section">
                <h3>Позиции закупки</h3>
                <div className="crm-purchase-item-list">
                  {selected.items.map((item) => (
                    <div key={item.id}>
                      <div>
                        <strong>{item.product.name}</strong>
                        <small>
                          {item.product.sku} · {money(item.purchasePriceMinor)}{' '}
                          сомони / шт.
                        </small>
                      </div>
                      <span
                        className={
                          item.quantityReceived === item.quantityOrdered
                            ? 'crm-receipt-complete'
                            : ''
                        }
                      >
                        {item.quantityReceived} / {item.quantityOrdered} шт.
                      </span>
                    </div>
                  ))}
                </div>
                <p className="crm-field-note">Принято / заказано</p>
              </section>
              {selected.sourceDocument && (
                <details className="crm-source-document">
                  <summary>
                    Исходная накладная · {selected.sourceDocument.filename}
                  </summary>
                  <p>
                    {selected.sourceDocument.date} ·{' '}
                    {selected.sourceDocument.currency} · курс{' '}
                    {selected.sourceDocument.exchangeRate}
                  </p>
                  {selected.sourceDocument.rows.map((row) => (
                    <div key={row.line}>
                      <strong>
                        {row.name} {row.characteristic}
                      </strong>
                      <p>
                        {row.quantity} × {row.price}{' '}
                        {selected.sourceDocument!.currency} · скидка{' '}
                        {row.discountPercent}%
                        {row.excluded
                          ? ` · Исключено: ${row.exclusionReason}`
                          : ''}
                      </p>
                    </div>
                  ))}
                </details>
              )}
              {formError && (
                <p className="crm-alert" role="alert">
                  {formError}
                </p>
              )}
              {selected.status === 'DRAFT' &&
                permissions.includes('purchases.submit') && (
                  <div className="crm-editor-section">
                    <p className="crm-field-note">
                      Проверьте товары и суммы. После отправки можно будет
                      принимать поставку.
                    </p>
                    <button
                      disabled={busy}
                      className="ks-button ks-button--primary crm-primary-button"
                      onClick={() => void action('submit')}
                    >
                      {busy ? 'Сохраняем…' : 'Отправить заказ'}
                      <ArrowRight size={16} aria-hidden />
                    </button>
                  </div>
                )}
              {['ORDERED', 'PARTIALLY_RECEIVED'].includes(selected.status) &&
                permissions.includes('purchases.receive') && (
                  <form className="crm-editor-section" onSubmit={receive}>
                    <h3>Приёмка товара</h3>
                    <p className="crm-field-note">
                      Укажите фактически полученное количество и партию.
                    </p>
                    <fieldset disabled={busy}>
                      <label>
                        Товар
                        <select
                          required
                          value={receiptItemId}
                          onChange={(event) => {
                            setReceiptItemId(event.target.value);
                            setReceiptQuantity('1');
                          }}
                        >
                          {selected.items
                            .filter(
                              (item) =>
                                item.quantityReceived < item.quantityOrdered,
                            )
                            .map((item) => (
                              <option key={item.id} value={item.id}>
                                {item.product.name} · осталось{' '}
                                {item.quantityOrdered - item.quantityReceived}{' '}
                                шт.
                              </option>
                            ))}
                        </select>
                      </label>
                      <div className="crm-editor-grid">
                        <label>
                          Количество · осталось {remaining} шт.
                          <TypedInput
                            required
                            type="number"
                            min={1}
                            max={remaining}
                            step={1}
                            value={receiptQuantity}
                            onChange={(event) =>
                              setReceiptQuantity(event.target.value)
                            }
                          />
                        </label>
                        <label>
                          Номер партии
                          <input
                            required
                            placeholder="Например, LOT-2026-11"
                            value={batchNumber}
                            onChange={(event) =>
                              setBatchNumber(event.target.value)
                            }
                          />
                        </label>
                      </div>
                      <details className="crm-receipt-dates">
                        <summary>Срок годности и дата производства</summary>
                        <div className="crm-editor-grid">
                          <label>
                            Дата производства
                            <input
                              type="date"
                              value={manufacturedAt}
                              onChange={(event) =>
                                setManufacturedAt(event.target.value)
                              }
                            />
                          </label>
                          <label>
                            Годен до
                            <input
                              type="date"
                              min={manufacturedAt || undefined}
                              value={expiresAt}
                              onChange={(event) =>
                                setExpiresAt(event.target.value)
                              }
                            />
                          </label>
                        </div>
                      </details>
                      <button
                        type="submit"
                        className="ks-button ks-button--primary crm-primary-button"
                        disabled={
                          !receiptItemId || Number(receiptQuantity) > remaining
                        }
                      >
                        {busy ? 'Принимаем…' : 'Принять и обновить остатки'}
                      </button>
                    </fieldset>
                  </form>
                )}
              {['DRAFT', 'ORDERED'].includes(selected.status) &&
                permissions.includes('purchases.cancel') && (
                  <div className="crm-purchase-cancel">
                    {cancelPending ? (
                      <>
                        <p>
                          Отменить эту закупку? Принять товары по ней будет
                          нельзя.
                        </p>
                        <div className="crm-workspace-actions">
                          <button
                            disabled={busy}
                            className="ks-button ks-button--secondary crm-outline-button"
                            onClick={() => setCancelPending(false)}
                          >
                            Оставить закупку
                          </button>
                          <button
                            disabled={busy}
                            className="ks-button ks-button--ghost ks-button--sm ks-button--danger-text crm-text-action is-danger"
                            onClick={() => void action('cancel')}
                          >
                            Да, отменить
                          </button>
                        </div>
                      </>
                    ) : (
                      <button
                        disabled={busy}
                        className="ks-button ks-button--ghost ks-button--sm ks-button--danger-text crm-text-action is-danger"
                        onClick={() => setCancelPending(true)}
                      >
                        Отменить закупку
                      </button>
                    )}
                  </div>
                )}
            </div>
          </CabinetDrawer>
        )}
      </div>
    </CatalogShell>
  );
}
