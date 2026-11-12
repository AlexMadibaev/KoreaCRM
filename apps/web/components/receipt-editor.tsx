'use client';

import { useEffect, useState } from 'react';
import { MoneyInput, formatCurrencyMinor } from '@koreacrm/ui';
import { api, queryString, type Page } from '../lib/api';
import type { Sale } from './sales-ledger';

type Product = { id: string; name: string; sku: string };
type Customer = { id: string; firstName: string; lastName: string | null; phone: string };
type Seller = { id: string; name: string };
type Method = { id: string; name: string };
type Line = { product: Product; quantity: string; priceMinor: string; discountMinor: string };
type Tender = { key: string; paymentMethodId: string; amountMinor: string; reference: string };
type EditData = {
  sale: Omit<Sale, 'payments'> & { customerId: string | null; sellerId: string | null; payments: (Sale['payments'][number] & { paymentMethodId: string; reference: string | null })[] };
  revision: string; methods: Method[]; blocked: string | null;
};
const minor = (value: string) => /^\d+$/.test(value) ? BigInt(value) : 0n;

export function ReceiptEditor({ saleId, storeId, onSaved }: { saleId: string; storeId: string; onSaved: (sale: Sale) => void }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<EditData | null>(null);
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [sellerId, setSellerId] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [comment, setComment] = useState('');
  const [reason, setReason] = useState('');
  const [search, setSearch] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    let active = true;
    setData(null);
    setError('');
    setReason('');
    Promise.all([
      api<EditData>(`/stores/${storeId}/sales/${saleId}/editor`),
      api<Seller[]>(`/stores/${storeId}/sales/edit/sellers`),
    ]).then(([payload, staff]) => {
      if (!active) return;
      const { sale } = payload;
      setData(payload);
      setSellers(staff);
      setSellerId(sale.sellerId ?? '');
      setCustomerId(sale.customerId ?? '');
      setComment(sale.comment ?? '');
      setLines(sale.items.map(item => ({ product: item.product, quantity: String(item.quantity), priceMinor: item.priceMinor, discountMinor: item.discountMinor })));
      setTenders(sale.payments.map(payment => ({ key: payment.id, paymentMethodId: payment.paymentMethodId, amountMinor: payment.amountMinor, reference: payment.reference ?? '' })));
    }).catch(caught => { if (active) setError(caught instanceof Error ? caught.message : 'Не удалось открыть чек'); });
    return () => { active = false; };
  }, [open, saleId, storeId]);

  useEffect(() => {
    setProducts([]);
    if (!open || !search.trim()) return;
    let active = true;
    const timer = window.setTimeout(() => {
      api<Page<Product>>(`/products?${queryString({ search: search.trim(), limit: 10 })}`).then(result => { if (active) setProducts(result.items); })
        .catch(() => { if (active) setError('Не удалось найти товары'); });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [open, search]);

  useEffect(() => {
    setCustomers([]);
    if (!open || !customerSearch.trim()) return;
    let active = true;
    const timer = window.setTimeout(() => {
      api<Page<Customer>>(`/customers?${queryString({ search: customerSearch.trim(), limit: 15 })}`).then(result => { if (active) setCustomers(result.items); })
        .catch(() => { if (active) setError('Не удалось найти клиентов'); });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [open, customerSearch]);

  const total = lines.reduce((sum, line) => sum + minor(line.quantity) * minor(line.priceMinor) - minor(line.discountMinor), 0n);
  const paid = tenders.reduce((sum, payment) => sum + minor(payment.amountMinor), 0n);
  function editLine(id: string, change: Partial<Line>) {
    setLines(current => current.map(line => line.product.id === id ? { ...line, ...change } : line));
  }
  function editTender(key: string, change: Partial<Tender>) {
    setTenders(current => current.map(tender => tender.key === key ? { ...tender, ...change } : tender));
  }
  async function save(cancel = false) {
    if (!data || data.blocked || saving) return;
    if (reason.trim().length < 5) { setError('Укажите причину изменения'); return; }
    if (!cancel && (!lines.length || lines.some(line => minor(line.quantity) <= 0n || !line.priceMinor) || !tenders.length || paid !== total)) {
      setError('Проверьте товары, количество и суммы оплаты');
      return;
    }
    if (cancel && !window.confirm(`Аннулировать чек №${data.sale.number} и пересчитать его смену?`)) return;
    setSaving(true);
    setError('');
    try {
      const updated = await api<Sale>(`/stores/${storeId}/sales/${saleId}/editor`, {
        method: 'PATCH',
        body: JSON.stringify({
          operationId: crypto.randomUUID(), revision: data.revision, sellerId: sellerId || null, customerId: customerId || null,
          reason, comment, void: cancel,
          items: cancel ? [] : lines.map(line => ({ productId: line.product.id, quantity: Number(line.quantity), priceMinor: minor(line.priceMinor).toString(), discountMinor: minor(line.discountMinor).toString() })),
          payments: cancel ? [] : tenders.map(tender => ({ paymentMethodId: tender.paymentMethodId, amountMinor: minor(tender.amountMinor).toString(), reference: tender.reference })),
        }),
      });
      setOpen(false);
      onSaved(updated);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Не удалось сохранить чек'); }
    finally { setSaving(false); }
  }

  const methods = new Map(data?.methods.map(method => [method.id, method]));
  for (const payment of data?.sale.payments ?? []) methods.set(payment.paymentMethodId, { id: payment.paymentMethodId, name: payment.paymentMethod.name });
  const originalSeller = data?.sale.seller;
  const originalCustomer = data?.sale.customer;
  return <div className="space-y-3 print:hidden">
    <button type="button" className="ks-button ks-button--secondary ks-button--sm" disabled={saving} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Закрыть редактор' : 'Редактировать чек'}</button>
    {open && error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {open && !data && !error && <p role="status">Загружаем чек…</p>}
    {open && data?.blocked && <p role="status">{data.blocked}. Для него доступна правка продавца и комментария в истории операций.</p>}
    {open && data && !data.blocked && <form className="space-y-4 rounded border p-3" onSubmit={event => { event.preventDefault(); void save(); }}>
      <p className="text-sm text-slate-600">Изменения попадут в исходную смену чека №{data.sale.number}.</p>
      <fieldset className="space-y-3" disabled={saving}>
        <label>Продавец<select className="block w-full rounded border p-2" value={sellerId} onChange={event => setSellerId(event.target.value)}>
          <option value="">Не указан</option>
          {originalSeller && !sellers.some(seller => seller.id === originalSeller.id) && <option value={originalSeller.id}>{originalSeller.name}</option>}
          {sellers.map(seller => <option key={seller.id} value={seller.id}>{seller.name}</option>)}
        </select></label>
        <label>Найти клиента<input type="search" className="block w-full rounded border p-2" value={customerSearch} onChange={event => setCustomerSearch(event.target.value)} /></label>
        <label>Клиент<select className="block w-full rounded border p-2" value={customerId} onChange={event => setCustomerId(event.target.value)}>
          <option value="">Без клиента</option>
          {originalCustomer && data.sale.customerId && !customers.some(customer => customer.id === data.sale.customerId) && <option value={data.sale.customerId}>{originalCustomer.firstName} · {originalCustomer.phone}</option>}
          {customers.map(customer => <option value={customer.id} key={customer.id}>{customer.firstName} {customer.lastName} · {customer.phone}</option>)}
          {customerId && customerId !== data.sale.customerId && !customers.some(customer => customer.id === customerId) && <option value={customerId}>Выбранный клиент</option>}
        </select></label>
        <label>Комментарий<textarea className="block w-full rounded border p-2" value={comment} maxLength={500} onChange={event => setComment(event.target.value)} /></label>
        <h3 className="font-semibold">Товары</h3>
        {lines.map(line => <div className="space-y-2 rounded border p-2" key={line.product.id}>
          <strong>{line.product.name} · {line.product.sku}</strong>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <label>Количество<input className="block w-full rounded border p-2" type="number" min="1" max="100000" value={line.quantity} onChange={event => editLine(line.product.id, { quantity: event.target.value })} /></label>
            <label>Цена за единицу<MoneyInput className="block w-full rounded border p-2" valueMinor={line.priceMinor} onMinorChange={priceMinor => editLine(line.product.id, { priceMinor })} /></label>
            <label>Скидка на позицию<MoneyInput className="block w-full rounded border p-2" valueMinor={line.discountMinor} onMinorChange={discountMinor => editLine(line.product.id, { discountMinor })} /></label>
          </div>
          <button type="button" className="ks-button ks-button--ghost ks-button--sm" onClick={() => setLines(lines.filter(item => item.product.id !== line.product.id))}>Убрать товар</button>
        </div>)}
        <label>Найти товар<input type="search" className="block w-full rounded border p-2" value={search} onChange={event => setSearch(event.target.value)} /></label>
        {products.filter(product => !lines.some(line => line.product.id === product.id)).map(product => <button key={product.id} type="button" className="ks-button ks-button--secondary ks-button--sm" onClick={() => {
          setLines(current => [...current, { product, quantity: '1', priceMinor: '', discountMinor: '0' }]);
          setSearch('');
        }}>Добавить {product.name} · {product.sku}</button>)}
        <h3 className="font-semibold">Оплаты</h3>
        {tenders.map(tender => <div className="grid gap-2 rounded border p-2 sm:grid-cols-2" key={tender.key}>
          <label>Способ оплаты<select className="block w-full rounded border p-2" value={tender.paymentMethodId} onChange={event => editTender(tender.key, { paymentMethodId: event.target.value })}>
            {[...methods.values()].map(method => <option key={method.id} value={method.id}>{method.name}</option>)}
          </select></label>
          <label>Сумма<MoneyInput className="block w-full rounded border p-2" valueMinor={tender.amountMinor} onMinorChange={amountMinor => editTender(tender.key, { amountMinor })} /></label>
          <label>Номер операции<input className="block w-full rounded border p-2" maxLength={200} value={tender.reference} onChange={event => editTender(tender.key, { reference: event.target.value })} /></label>
          <button type="button" className="ks-button ks-button--ghost ks-button--sm self-end" onClick={() => setTenders(tenders.filter(item => item.key !== tender.key))}>Убрать оплату</button>
        </div>)}
        <button type="button" className="ks-button ks-button--secondary ks-button--sm" disabled={!methods.size} onClick={() => setTenders([...tenders, { key: crypto.randomUUID(), paymentMethodId: methods.keys().next().value ?? '', amountMinor: (total > paid ? total - paid : 0n).toString(), reference: '' }])}>Добавить оплату</button>
        <p className="font-semibold">Итого {formatCurrencyMinor(total.toString())} · Оплачено {formatCurrencyMinor(paid.toString())}</p>
        <label>Причина изменения<input className="block w-full rounded border p-2" minLength={5} maxLength={500} required value={reason} onChange={event => setReason(event.target.value)} /></label>
        <div className="flex flex-wrap gap-2">
          <button type="submit" className="ks-button ks-button--primary">{saving ? 'Сохраняем…' : 'Сохранить чек'}</button>
          <button type="button" className="ks-button ks-button--ghost ks-button--danger-text" onClick={() => void save(true)}>Аннулировать чек</button>
        </div>
      </fieldset>
    </form>}
  </div>;
}
