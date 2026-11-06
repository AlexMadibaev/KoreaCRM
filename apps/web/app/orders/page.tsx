'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { MoneyInput, formatCurrencyMinor as money } from '@koreacrm/ui';
import { CatalogShell } from '../../components/catalog-shell';
import { OrderEditor } from '../../components/order-editor';
import { api, queryString, type Page } from '../../lib/api';
import {
  orderStatusLabels,
  paymentStatusLabels,
  type CustomerOrder,
  type OrderDraft,
} from '../../lib/orders';

type Store = { id: string; name: string };
type Method = { id: string; name: string; kind: string; active: boolean };
type Shift = { id: string; deviceId: string; openedById: string };
const eventLabels: Record<string, string> = {
  ORDER_CREATED: 'Создан черновик',
  ORDER_EDITED: 'Изменён черновик',
  ORDER_CONFIRMED: 'Товар зарезервирован',
  ORDER_READY: 'Заказ готов',
  ORDER_PAYMENT: 'Принята оплата',
  ORDER_COMPLETED: 'Заказ выдан, создан чек',
  ORDER_CANCELLED: 'Заказ отменён, резерв снят',
};
const eventDetailLabels: Record<string, string> = {
  reason: 'Причина',
  method: 'Оплата',
  number: 'Номер',
  amountMinor: 'Сумма',
  totalMinor: 'Итого',
  refundedMinor: 'Возвращено',
};

export default function OrdersPage() {
  const [stores, setStores] = useState<Store[]>([]);
  const [storeId, setStoreId] = useState('');
  const currentStore = useRef('');
  const [me, setMe] = useState<{
    userId: string;
    permissions: string[];
  } | null>(null);
  const [list, setList] = useState<Page<CustomerOrder> | null>(null);
  const [selected, setSelected] = useState<CustomerOrder | null>(null);
  const [editing, setEditing] = useState(false);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [methods, setMethods] = useState<Method[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [shiftId, setShiftId] = useState('');
  const [methodId, setMethodId] = useState('');
  const [amount, setAmount] = useState('0');
  const [paymentId, setPaymentId] = useState('');
  const [completionId, setCompletionId] = useState('');
  const [cancelId, setCancelId] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const can = (permission: string) =>
    me?.permissions.includes(permission) ?? false;

  function chooseStore(id: string) {
    currentStore.current = id;
    setStoreId(id);
    setSelected(null);
    setList(null);
    setEditing(false);
    setCancelOpen(false);
    setPage(1);
    setShiftId('');
  }

  useEffect(() => {
    Promise.all([
      api<Store[]>('/stores'),
      api<{ userId: string; permissions: string[] }>('/auth/me'),
      api<Method[]>('/sale-payment-methods'),
    ])
      .then(([locations, profile, payments]) => {
        setStores(locations);
        setMe(profile);
        setMethods(
          payments.filter(
            (method) =>
              method.active && !['BONUS', 'DEBT'].includes(method.kind),
          ),
        );
        chooseStore(locations[0]?.id ?? '');
        setEditing(
          new URLSearchParams(window.location.search).get('new') === '1' &&
            profile.permissions.includes('orders.create'),
        );
      })
      .catch((caught) => setError(caught.message));
  }, []);

  useEffect(() => {
    if (!storeId) return;
    let active = true;
    setLoading(true);
    const timer = setTimeout(() => {
      api<Page<CustomerOrder>>(
        `/stores/${storeId}/orders?${queryString({ page, limit: 20, search, status: status || undefined })}`,
      )
        .then((result) => {
          if (active) setList(result);
        })
        .catch((caught) => {
          if (active) setError(caught.message);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [storeId, page, search, status, refresh]);

  useEffect(() => {
    setShifts([]);
    if (!storeId || !me?.permissions.includes('finance.cash_view')) return;
    let active = true;
    api<Page<Shift>>(
      `/stores/${storeId}/finance/cash-shifts?status=OPEN&limit=100`,
    )
      .then((result) => {
        if (active) setShifts(result.items);
      })
      .catch((caught) => {
        if (active) setError(caught.message);
      });
    return () => {
      active = false;
    };
  }, [storeId, me, refresh]);

  const select = useCallback((order: CustomerOrder) => {
    setSelected(order);
    setEditing(false);
    setCancelOpen(false);
    setAmount((BigInt(order.totalMinor) - BigInt(order.paidMinor)).toString());
    setPaymentId(crypto.randomUUID());
    setCompletionId(crypto.randomUUID());
    setCancelId(crypto.randomUUID());
    setCancelReason('');
  }, []);

  async function loadOrder(id: string) {
    setError('');
    setBusy(true);
    const location = storeId;
    try {
      const order = await api<CustomerOrder>(
        `/stores/${location}/orders/${id}`,
      );
      if (currentStore.current === location) select(order);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function action(path: string, body: unknown, method = 'POST') {
    if (!selected) return;
    const location = storeId;
    setBusy(true);
    setError('');
    try {
      const order = await api<CustomerOrder>(
        `/stores/${location}/orders/${selected.id}${path}`,
        { method, body: JSON.stringify(body) },
      );
      if (currentStore.current === location) {
        select(order);
        setRefresh((value) => value + 1);
      }
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function save(draft: OrderDraft, operationId: string) {
    const location = storeId;
    setBusy(true);
    setError('');
    try {
      const order = await api<CustomerOrder>(
        `/stores/${location}/orders${selected ? `/${selected.id}` : ''}`,
        {
          method: selected ? 'PATCH' : 'POST',
          body: JSON.stringify(
            selected
              ? { version: selected.version, draft }
              : { operationId, draft },
          ),
        },
      );
      if (currentStore.current === location) {
        select(order);
        setRefresh((value) => value + 1);
      }
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const method = methods.find((method) => method.id === methodId);
  const activeOrder =
    selected && ['CONFIRMED', 'READY'].includes(selected.status);
  const ownShifts = shifts.filter((shift) => shift.openedById === me?.userId);
  const paymentChanged = () => setPaymentId(crypto.randomUUID());

  return (
    <CatalogShell>
      <div className="space-y-5">
        <header className="crm-page-head">
          <div>
            <span className="crm-eyebrow">КЛИЕНТСКИЕ ЗАКАЗЫ</span>
            <h1>Заказы</h1>
            <p>Резерв, предоплата, выдача и доставка.</p>
          </div>
          {can('orders.create') && (
            <button
              type="button"
              disabled={busy || !storeId}
              className="crm-primary-button"
              onClick={() => {
                setSelected(null);
                setEditing(true);
                setCancelOpen(false);
                setError('');
              }}
            >
              Новый заказ
            </button>
          )}
        </header>
        {error && (
          <p role="alert" className="crm-alert">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          <label>
            Магазин
            <select
              disabled={busy}
              className="ml-2 rounded-lg border p-2"
              value={storeId}
              onChange={(event) => chooseStore(event.target.value)}
            >
              {stores.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Статус
            <select
              className="ml-2 rounded-lg border p-2"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
            >
              <option value="">Все</option>
              {Object.entries(orderStatusLabels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Поиск
            <input
              className="ml-2 rounded-lg border p-2"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Номер, имя, телефон"
            />
          </label>
        </div>
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <section
            className="crm-panel min-w-0 p-4"
            aria-label="Список заказов"
          >
            {loading && <p role="status">Загрузка…</p>}
            <div className="space-y-2">
              {list?.items.map((order) => (
                <button
                  key={order.id}
                  type="button"
                  disabled={busy}
                  className={`flex w-full flex-wrap justify-between gap-2 rounded-lg border p-3 text-left ${selected?.id === order.id ? 'border-rose-400 bg-rose-50' : ''}`}
                  onClick={() => void loadOrder(order.id)}
                >
                  <span>
                    <strong>
                      №{order.number} · {orderStatusLabels[order.status]}
                    </strong>
                    <small className="block">
                      {order.customer?.firstName ?? 'Без клиента'} ·{' '}
                      {order.contactPhone || order.customer?.phone}
                    </small>
                  </span>
                  <span>
                    {money(order.totalMinor)}
                    <small className="block">
                      Оплачено {money(order.paidMinor)}
                    </small>
                  </span>
                </button>
              ))}
            </div>
            {!loading && !list?.items.length && (
              <p className="p-5 text-slate-500">Заказы не найдены.</p>
            )}
            {list && list.total > 20 && (
              <div className="mt-4 flex justify-between">
                <button
                  disabled={page <= 1 || busy}
                  onClick={() => setPage(page - 1)}
                >
                  Назад
                </button>
                <span>
                  {page} / {Math.ceil(list.total / 20)}
                </span>
                <button
                  disabled={page * 20 >= list.total || busy}
                  onClick={() => setPage(page + 1)}
                >
                  Далее
                </button>
              </div>
            )}
          </section>
          {editing ? (
            <OrderEditor
              key={`${storeId}:${selected?.id ?? 'new'}`}
              storeId={storeId}
              order={selected}
              canViewCustomers={can('customers.view')}
              busy={busy}
              onSave={save}
              onClose={() => setEditing(false)}
            />
          ) : selected ? (
            <section
              className="crm-panel min-w-0 space-y-4 p-5"
              aria-label="Карточка заказа"
            >
              <div>
                <h2 className="text-xl font-semibold">
                  Заказ №{selected.number}
                </h2>
                <p>
                  {orderStatusLabels[selected.status]} ·{' '}
                  {new Date(selected.createdAt).toLocaleString('ru-RU')}
                </p>
                <p>
                  {selected.deliveryMethod === 'DELIVERY'
                    ? `Доставка · ${selected.deliveryAddress}`
                    : 'Самовывоз'}{' '}
                  · {selected.contactPhone}
                </p>
                {selected.comment && <p>{selected.comment}</p>}
              </div>
              <ul className="divide-y">
                {selected.items.map((item) => (
                  <li
                    key={item.id}
                    className="flex flex-wrap justify-between gap-2 py-2"
                  >
                    <span>
                      {item.name} × {item.quantity}
                      <small className="block">
                        {item.sku}
                        {item.discountMinor !== '0'
                          ? ` · скидка ${money(item.discountMinor)}`
                          : ''}
                      </small>
                    </span>
                    <strong>{money(item.totalMinor)}</strong>
                  </li>
                ))}
              </ul>
              <div className="rounded-lg bg-rose-50 p-3">
                <p>Всего {money(selected.totalMinor)}</p>
                <p>
                  {paymentStatusLabels[selected.paymentStatus]} ·{' '}
                  {money(selected.paidMinor)}
                </p>
                <strong>
                  Осталось{' '}
                  {money(
                    (
                      BigInt(selected.totalMinor) - BigInt(selected.paidMinor)
                    ).toString(),
                  )}
                </strong>
              </div>
              <div className="flex flex-wrap gap-3">
                {selected.status === 'DRAFT' && (
                  <>
                    {can('orders.edit') && (
                      <button
                        disabled={busy}
                        className="rounded border p-2"
                        onClick={() => setEditing(true)}
                      >
                        Изменить
                      </button>
                    )}
                    {can('orders.confirm') && (
                      <button
                        disabled={busy}
                        className="crm-primary-button"
                        onClick={() =>
                          void action('/confirm', { version: selected.version })
                        }
                      >
                        Подтвердить и зарезервировать
                      </button>
                    )}
                  </>
                )}
                {selected.status === 'CONFIRMED' && can('orders.edit') && (
                  <button
                    disabled={busy}
                    className="rounded border p-2"
                    onClick={() => void action('/ready', {})}
                  >
                    Готов к выдаче
                  </button>
                )}
                {!['COMPLETED', 'CANCELLED'].includes(selected.status) &&
                  can('orders.cancel') && (
                    <button
                      disabled={busy}
                      className="rounded border border-rose-300 p-2"
                      onClick={() => setCancelOpen((value) => !value)}
                    >
                      Отменить заказ
                    </button>
                  )}
              </div>
              {activeOrder && (
                <label className="block">
                  Кассовая смена
                  <select
                    className="mt-1 w-full rounded border p-2"
                    value={shiftId}
                    onChange={(event) => {
                      setShiftId(event.target.value);
                      setCompletionId(crypto.randomUUID());
                      setCancelId(crypto.randomUUID());
                      paymentChanged();
                    }}
                  >
                    <option value="">Выберите открытую смену</option>
                    {ownShifts.map((shift) => (
                      <option key={shift.id} value={shift.id}>
                        {shift.deviceId}
                      </option>
                    ))}
                  </select>
                  <small>Для наличных операций и выдачи заказа.</small>
                </label>
              )}
              {activeOrder &&
                can('orders.pay') &&
                BigInt(selected.paidMinor) < BigInt(selected.totalMinor) && (
                  <form
                    className="space-y-3 rounded-lg border p-3"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void action('/payments', {
                        operationId: paymentId,
                        paymentMethodId: methodId,
                        amountMinor: amount,
                        ...(method?.kind === 'CASH'
                          ? { cashShiftId: shiftId }
                          : {}),
                      });
                    }}
                  >
                    <h3 className="font-semibold">Принять оплату</h3>
                    <label className="block">
                      Способ оплаты
                      <select
                        required
                        className="mt-1 w-full rounded border p-2"
                        value={methodId}
                        onChange={(event) => {
                          setMethodId(event.target.value);
                          paymentChanged();
                        }}
                      >
                        <option value="">Выберите</option>
                        {methods
                          .filter(
                            (method) =>
                              method.kind !== 'CASH' || can('finance.cash'),
                          )
                          .map((method) => (
                            <option key={method.id} value={method.id}>
                              {method.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label className="block">
                      Сумма, сомони
                      <MoneyInput
                        required
                        className="mt-1 w-full rounded border p-2"
                        valueMinor={amount}
                        onMinorChange={(value) => {
                          setAmount(value);
                          paymentChanged();
                        }}
                      />
                    </label>
                    <button
                      disabled={
                        busy ||
                        !methodId ||
                        BigInt(amount || '0') <= 0n ||
                        (method?.kind === 'CASH' && !shiftId)
                      }
                      className="crm-primary-button"
                    >
                      Принять предоплату
                    </button>
                  </form>
                )}
              {activeOrder &&
                selected.paidMinor === selected.totalMinor &&
                can('orders.fulfill') &&
                can('sales.create') && (
                  <button
                    disabled={busy || !shiftId}
                    className="crm-primary-button"
                    onClick={() =>
                      void action('/complete', {
                        operationId: completionId,
                        cashShiftId: shiftId,
                      })
                    }
                  >
                    Выдать заказ и создать чек
                  </button>
                )}
              {cancelOpen && (
                <section className="space-y-3 rounded-lg border border-rose-300 p-3">
                  <h3 className="font-semibold">Подтверждение отмены</h3>
                  <p>
                    Предоплата {money(selected.paidMinor)} будет возвращена
                    исходными способами оплаты. Резерв будет снят. Для возврата
                    наличных выберите свою открытую смену выше.
                  </p>
                  <p className="text-sm">
                    Возврат по карте проведите на терминале и подтвердите здесь.
                  </p>
                  <label className="block">
                    Причина
                    <input
                      required
                      minLength={3}
                      maxLength={1000}
                      className="mt-1 w-full rounded border p-2"
                      value={cancelReason}
                      onChange={(event) => {
                        setCancelReason(event.target.value);
                        setCancelId(crypto.randomUUID());
                      }}
                    />
                  </label>
                  <button
                    disabled={busy || cancelReason.trim().length < 3}
                    className="crm-primary-button"
                    onClick={() =>
                      void action('/cancel', {
                        operationId: cancelId,
                        reason: cancelReason,
                        ...(selected.payments.some(
                          (payment) => payment.paymentMethod.kind === 'CASH',
                        )
                          ? { cashShiftId: shiftId }
                          : {}),
                      })
                    }
                  >
                    Подтверждаю отмену и возврат предоплаты
                  </button>
                </section>
              )}
              {selected.sale && (
                <div className="rounded-lg border p-3">
                  <strong>Чек №{selected.sale.number}</strong>
                  <p>Возвраты по выданному заказу оформляются по этому чеку.</p>
                  <Link
                    className="underline"
                    href={`/sales?storeId=${storeId}&saleId=${selected.sale.id}`}
                  >
                    Продажи и возвраты
                  </Link>
                  {selected.sale.returns.map((refund) => (
                    <p key={refund.id}>
                      Возврат {money(refund.amountMinor)} ·{' '}
                      {new Date(refund.createdAt).toLocaleString('ru-RU')}
                    </p>
                  ))}
                </div>
              )}
              <details>
                <summary>Оплаты и возвраты предоплаты</summary>
                {selected.payments.map((payment) => (
                  <p key={payment.id} className="py-1">
                    {payment.paymentMethod.name} · {money(payment.amountMinor)}{' '}
                    · {new Date(payment.createdAt).toLocaleString('ru-RU')}
                  </p>
                ))}
              </details>
              <details open>
                <summary>История заказа</summary>
                {selected.events.map((event) => (
                  <div key={event.id} className="border-b py-2 text-sm">
                    <strong>{eventLabels[event.action] ?? event.action}</strong>
                    <p>
                      {event.employee.name} ·{' '}
                      {new Date(event.createdAt).toLocaleString('ru-RU')}
                    </p>
                    {Object.entries(event.details)
                      .filter(([key]) => Object.hasOwn(eventDetailLabels, key))
                      .map(([key, value]) => (
                        <span key={key} className="mr-3 break-all">
                          {eventDetailLabels[key]}{' '}
                          {key === 'amountMinor' ||
                          key === 'refundedMinor' ||
                          key === 'totalMinor'
                            ? money(String(value))
                            : String(value)}
                        </span>
                      ))}
                  </div>
                ))}
              </details>
            </section>
          ) : (
            <aside className="crm-panel p-5 text-slate-500">
              Выберите заказ или создайте новый.
            </aside>
          )}
        </div>
      </div>
    </CatalogShell>
  );
}
