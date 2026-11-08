'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { CatalogShell } from '../../../components/catalog-shell';
import { api, type Page } from '../../../lib/api';
import { formatCurrencyMinor as money } from '@koreacrm/ui';

type Named = { id: string; name: string };
type Batch = {
  id: string;
  batchNumber: string;
  purchasePriceMinor: string;
  quantity: number;
  receivedAt: string;
  manufacturedAt: string | null;
  expiresAt: string | null;
  product: Named & { sku: string };
  supplier: Named;
  purchaseItem: { purchase: { id: string; number: string } };
};
const date = (value: string | null) =>
  value
    ? new Date(value).toLocaleDateString('ru-RU', { timeZone: 'Asia/Dushanbe' })
    : '—';
export default function PurchaseHistoryPage() {
  const [stores, setStores] = useState<Named[]>([]),
    [storeId, setStoreId] = useState('');
  const [search, setSearch] = useState(''),
    [page, setPage] = useState(1),
    [result, setResult] = useState<Page<Batch> | null>(null);
  const [error, setError] = useState(''),
    [loading, setLoading] = useState(false);
  useEffect(() => {
    api<Named[]>('/stores')
      .then((items) => {
        setStores(items);
        setStoreId(items[0]?.id ?? '');
      })
      .catch((reason) =>
        setError(reason instanceof Error ? reason.message : 'Ошибка загрузки'),
      );
  }, []);
  useEffect(() => {
    if (!storeId) return;
    let active = true;
    setLoading(true);
    setError('');
    setResult(null);
    const timer = setTimeout(() => {
      api<Page<Batch>>(
        `/stores/${storeId}/purchases/price-history?limit=50&page=${page}&search=${encodeURIComponent(search)}`,
      )
        .then((items) => {
          if (active) setResult(items);
        })
        .catch((reason) => {
          if (active)
            setError(
              reason instanceof Error ? reason.message : 'Ошибка загрузки',
            );
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [storeId, search, page]);
  return (
    <CatalogShell>
      <div className="crm-screen ">
        <div className="crm-page-head">
          <div>
            <span className="crm-eyebrow">ПОСТАВКИ</span>
            <h1>История закупочных цен</h1>
            <p>
              Фактические партии по поставщикам и датам приёмки. Новая закупка
              сохраняет цену предыдущих партий.
            </p>
          </div>
          <div className="crm-page-actions"><Link className="ks-button ks-button--secondary crm-outline-button" href="/purchases">
            К закупкам
          </Link></div>
        </div>
        {error && (
          <p className="crm-alert" role="alert">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-4">
          <label>
            Магазин
            <select
              className="ml-2 rounded border p-2"
              value={storeId}
              onChange={(event) => {
                setStoreId(event.target.value);
                setPage(1);
              }}
            >
              {stores.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Товар
            <input
              type="search"
              placeholder="Название, артикул или штрихкод"
              className="ml-2 rounded border p-2"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
          </label>
        </div>
        {loading && <p role="status">Загрузка…</p>}
        <div className="overflow-x-auto rounded border bg-white">
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                <th className="p-3">Дата приёмки</th>
                <th>Товар</th>
                <th>Поставщик</th>
                <th>Закупка / партия</th>
                <th>Цена, сомони</th>
                <th>Принято в партию</th>
                <th>Срок годности</th>
              </tr>
            </thead>
            <tbody>
              {result?.items.map((batch) => (
                <tr key={batch.id} className="border-t">
                  <td className="p-3">{date(batch.receivedAt)}</td>
                  <td>
                    {batch.product.name}
                    <small className="block">{batch.product.sku}</small>
                  </td>
                  <td>{batch.supplier.name}</td>
                  <td>
                    {batch.purchaseItem.purchase.number} / {batch.batchNumber}
                  </td>
                  <td>{money(batch.purchasePriceMinor)}</td>
                  <td>{batch.quantity}</td>
                  <td>{date(batch.expiresAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {result && !result.items.length && (
            <p className="p-4">Принятые партии не найдены.</p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            disabled={loading || page <= 1}
            className="ks-button ks-button--secondary crm-outline-button"
            onClick={() => setPage(page - 1)}
          >
            Назад
          </button>
          <span>
            Страница {page} · партий: {result?.total ?? '—'}
          </span>
          <button
            disabled={loading || !result || page * result.limit >= result.total}
            className="ks-button ks-button--secondary crm-outline-button"
            onClick={() => setPage(page + 1)}
          >
            Далее
          </button>
        </div>
      </div>
    </CatalogShell>
  );
}
