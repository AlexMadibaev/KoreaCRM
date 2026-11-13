'use client';

import { TypedInput } from '@koreacrm/ui';
import { useEffect, useState, type FormEvent } from 'react';
import { api, queryString, type Page } from '../lib/api';
import type { CustomerOrder, OrderDraft } from '../lib/orders';

type ProductOption = {
  id: string;
  name: string;
  sku: string;
  priceMinor: number | null;
  active: boolean;
};
type CustomerOption = { id: string; firstName: string; phone: string };

export function OrderEditor({
  storeId,
  order,
  canViewCustomers,
  busy,
  onSave,
  onClose,
}: {
  storeId: string;
  order: CustomerOrder | null;
  canViewCustomers: boolean;
  busy: boolean;
  onSave: (draft: OrderDraft, operationId: string) => Promise<void>;
  onClose: () => void;
}) {
  const [operationId] = useState(() => crypto.randomUUID());
  const [draft, setDraft] = useState<OrderDraft>(() => ({
    customerId: order?.customerId ?? null,
    deliveryMethod: order?.deliveryMethod ?? 'PICKUP',
    deliveryAddress: order?.deliveryAddress ?? '',
    contactPhone: order?.contactPhone ?? '',
    comment: order?.comment ?? '',
    items:
      order?.items.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
      })) ?? [],
  }));
  const [names, setNames] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      order?.items.map((item) => [
        item.productId,
        `${item.name} · ${item.sku}`,
      ]) ?? [],
    ),
  );
  const [search, setSearch] = useState('');
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [customerSearch, setCustomerSearch] = useState(
    order?.customer?.phone ?? '',
  );
  const [customers, setCustomers] = useState<CustomerOption[]>(
    order?.customer ? [{ id: order.customerId!, ...order.customer }] : [],
  );
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      api<Page<ProductOption>>(
        `/stores/${storeId}/pos-products?${queryString({ search, limit: 20 })}`,
      )
        .then((page) => {
          if (active) setProducts(page.items);
        })
        .catch((caught) => {
          if (active) setError(caught.message);
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [storeId, search]);

  useEffect(() => {
    if (!canViewCustomers || !customerSearch.trim()) return;
    let active = true;
    const timer = setTimeout(() => {
      api<Page<CustomerOption>>(
        `/customers?${queryString({ search: customerSearch, limit: 20 })}`,
      )
        .then((page) => {
          if (active)
            setCustomers((previous) => [
              ...previous.filter(
                (customer) => customer.id === draft.customerId,
              ),
              ...page.items.filter(
                (customer) => customer.id !== draft.customerId,
              ),
            ]);
        })
        .catch((caught) => {
          if (active) setError(caught.message);
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [customerSearch, canViewCustomers, draft.customerId]);

  function addProduct(product: ProductOption) {
    setNames((current) => ({
      ...current,
      [product.id]: `${product.name} · ${product.sku}`,
    }));
    setDraft((current) => {
      const existing = current.items.find(
        (item) => item.productId === product.id,
      );
      return {
        ...current,
        items: existing
          ? current.items.map((item) =>
              item.productId === product.id
                ? { ...item, quantity: Math.min(100000, item.quantity + 1) }
                : item,
            )
          : [...current.items, { productId: product.id, quantity: 1 }],
      };
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft.items.length) {
      setError('Добавьте хотя бы один товар.');
      return;
    }
    setError('');
    await onSave(draft, operationId);
  }

  return (
    <section className="crm-panel space-y-4 p-5" aria-label="Редактор заказа">
      <div className="flex justify-between gap-3">
        <h2 className="text-lg font-semibold">
          {order ? `Черновик №${order.number}` : 'Новый заказ'}
        </h2>
        <button className="ks-button ks-button--secondary" type="button" disabled={busy} onClick={onClose}>
          Закрыть
        </button>
      </div>
      {error && (
        <p role="alert" className="crm-alert">
          {error}
        </p>
      )}
      <form onSubmit={(event) => void submit(event)} className="space-y-4">
        {canViewCustomers && (
          <div className="space-y-2">
            <label className="block">
              Найти клиента
              <input
                className="mt-1 w-full rounded-lg border p-2"
                value={customerSearch}
                onChange={(event) => setCustomerSearch(event.target.value)}
                placeholder="Имя или телефон"
              />
            </label>
            <label className="block">
              Клиент
              <select
                className="mt-1 w-full rounded-lg border p-2"
                value={draft.customerId ?? ''}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    customerId: event.target.value || null,
                    contactPhone:
                      customers.find(
                        (customer) => customer.id === event.target.value,
                      )?.phone ?? draft.contactPhone,
                  })
                }
              >
                <option value="">Без клиента</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.firstName} · {customer.phone}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <label>
            Способ получения
            <select
              className="mt-1 w-full rounded-lg border p-2"
              value={draft.deliveryMethod}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  deliveryMethod: event.target
                    .value as OrderDraft['deliveryMethod'],
                })
              }
            >
              <option value="PICKUP">Самовывоз</option>
              <option value="DELIVERY">Доставка</option>
            </select>
          </label>
          <label>
            Контактный телефон
            <input
              className="mt-1 w-full rounded-lg border p-2"
              value={draft.contactPhone}
              maxLength={50}
              required={draft.deliveryMethod === 'DELIVERY'}
              onChange={(event) =>
                setDraft({ ...draft, contactPhone: event.target.value })
              }
            />
          </label>
        </div>
        {draft.deliveryMethod === 'DELIVERY' && (
          <label className="block">
            Адрес доставки
            <input
              required
              className="mt-1 w-full rounded-lg border p-2"
              maxLength={1000}
              value={draft.deliveryAddress}
              onChange={(event) =>
                setDraft({ ...draft, deliveryAddress: event.target.value })
              }
            />
          </label>
        )}
        <label className="block">
          Поиск товаров
          <input
            className="mt-1 w-full rounded-lg border p-2"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Название, артикул или штрихкод"
          />
        </label>
        <div className="max-h-48 space-y-1 overflow-y-auto">
          {products.map((product) => (
            <button
              type="button"
              key={product.id}
              disabled={
                !product.active ||
                product.priceMinor === null ||
                draft.items.length >= 100 ||
                busy
              }
              className="ks-button ks-button--secondary"
              onClick={() => addProduct(product)}
            >
              {product.name} · {product.sku}{' '}
              {product.priceMinor === null ? '· нет цены' : '· добавить'}
            </button>
          ))}
        </div>
        <ul className="space-y-2">
          {draft.items.map((item) => (
            <li
              key={item.productId}
              className="flex flex-wrap items-center gap-3 rounded-lg bg-slate-50 p-3"
            >
              <span className="min-w-0 flex-1">{names[item.productId]}</span>
              <label>
                Количество
                <TypedInput
                  required
                  type="number"
                  min="1"
                  max="100000"
                  step="1"
                  className="ml-2 w-24 rounded border p-2"
                  value={item.quantity}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      items: draft.items.map((line) =>
                        line.productId === item.productId
                          ? { ...line, quantity: Number(event.target.value) }
                          : line,
                      ),
                    })
                  }
                />
              </label>
              <button className="ks-button ks-button--danger"
                type="button"
                onClick={() =>
                  setDraft({
                    ...draft,
                    items: draft.items.filter(
                      (line) => line.productId !== item.productId,
                    ),
                  })
                }
              >
                Удалить
              </button>
            </li>
          ))}
        </ul>
        <label className="block">
          Комментарий
          <textarea
            maxLength={1000}
            className="mt-1 w-full rounded-lg border p-2"
            value={draft.comment}
            onChange={(event) =>
              setDraft({ ...draft, comment: event.target.value })
            }
          />
        </label>
        <p className="text-sm text-slate-500">
          Сумма и автоматические скидки рассчитываются при сохранении.
          Подтверждение заказа резервирует товар.
        </p>
        <button
          type="submit"
          disabled={busy || !draft.items.length}
          className="ks-button ks-button--primary"
        >
          Сохранить черновик
        </button>
      </form>
    </section>
  );
}
