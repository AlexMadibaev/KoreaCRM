'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { MoneyInput } from '@koreacrm/ui';
import { CatalogShell } from '../../components/catalog-shell';
import { SalesLedger, type Sale } from '../../components/sales-ledger';
import { api, queryString, type Page } from '../../lib/api';
import { calculateSaleTotals, type ReceiptDiscount } from '../../lib/sale-calculations';
import { loyaltyPercent, type LoyaltySettings } from '../../lib/loyalty';

type Store = { id: string; name: string };
type Product = { id: string; name: string; sku: string; brandId: string | null; categoryId: string | null };
type Stock = { productId: string; quantity: number; reservedQuantity: number };
type Settings = { priceMinor: number | null; active: boolean } | null;
type Method = { id: string; name: string; kind: string; active: boolean };
type Customer = { id: string; firstName: string; lastName: string | null; phone: string; discountPercent: string; bonusBalanceMinor: string };
type Shift = { id: string; deviceId: string; status: string; expectedCashMinor: string };
type Line = { productId: string; name: string; sku: string; brandId: string | null; categoryId: string | null; quantity: number; available: number; priceMinor: number; discountMinor: string };
type Tender = { key: string; paymentMethodId: string; amountMinor: string; reference: string };
const format = (minor: string | number | bigint) => { const value = BigInt(minor); const absolute = value < 0n ? -value : value; return `${value < 0n ? '-' : ''}${new Intl.NumberFormat('ru-RU').format(absolute / 100n)},${String(absolute % 100n).padStart(2, '0')}`; };
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Не удалось выполнить операцию';
const validMoney = (value: string) => /^(0|[1-9]\d{0,17})$/.test(value);

export default function SalesPage() {
  const [permissions, setPermissions] = useState<string[]>([]), [stores, setStores] = useState<Store[]>([]), [storeId, setStoreId] = useState('');
  const [methods, setMethods] = useState<Method[]>([]), [customers, setCustomers] = useState<Customer[]>([]), [customerId, setCustomerId] = useState(''), [customerSearch, setCustomerSearch] = useState('');
  const [loyalty, setLoyalty] = useState<LoyaltySettings | null>(null);
  const [shifts, setShifts] = useState<Shift[]>([]), [cashShiftId, setCashShiftId] = useState(''), [browserId, setBrowserId] = useState(''), [openingCash, setOpeningCash] = useState('0');
  const [search, setSearch] = useState(''), [products, setProducts] = useState<Product[]>([]), [lines, setLines] = useState<Line[]>([]);
  const [receiptDiscountKind, setReceiptDiscountKind] = useState<ReceiptDiscount['kind']>('FIXED'), [receiptDiscountValue, setReceiptDiscountValue] = useState('0');
  const [stockNotice, setStockNotice] = useState('');
  const [tenders, setTenders] = useState<Tender[]>([]), [operationId, setOperationId] = useState('');
  const [receipt, setReceipt] = useState<Sale | null>(null), [salesRevision, setSalesRevision] = useState(0);
  const [returnNotice, setReturnNotice] = useState('');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [deviceReady, setDeviceReady] = useState(false);
  const can = (permission: string) => permissions.includes(permission);
  const deviceId = browserId && storeId ? `${browserId}-${storeId}` : '';
  const selectedCustomer = customers.find(customer => customer.id === customerId);
  let totals: ReturnType<typeof calculateSaleTotals> | null = null;
  let saleError = '';
  try { if (lines.length && loyalty) { const gross = lines.reduce((sum, line) => sum + BigInt(line.priceMinor) * BigInt(line.quantity), 0n); totals = calculateSaleTotals(lines, lines.map(line => loyaltyPercent(loyalty, line, selectedCustomer?.discountPercent ?? null, gross)), { kind: receiptDiscountKind, value: receiptDiscountValue }); } }
  catch (caught) { saleError = caught instanceof Error && caught.message === 'Receipt discount exceeds remaining total' ? 'Скидка на чек превышает сумму после других скидок.' : 'Проверьте товары, количество и скидки.'; }
  const total = totals?.total ?? 0n;
  const tendered = tenders.reduce((value, tender) => value + BigInt(validMoney(tender.amountMinor) ? tender.amountMinor : '0'), 0n);
  const cashTender = tenders.some(tender => methods.find(method => method.id === tender.paymentMethodId)?.kind === 'CASH');
  const bonusTendered = tenders.filter(tender => methods.find(method => method.id === tender.paymentMethodId)?.kind === 'BONUS').reduce((sum, tender) => sum + BigInt(validMoney(tender.amountMinor) ? tender.amountMinor : '0'), 0n);

  useEffect(() => {
    const saved = localStorage.getItem('koreacrm-web-pos-device');
    const device = saved || `WEB-${crypto.randomUUID()}`;
    if (!saved) localStorage.setItem('koreacrm-web-pos-device', device);
    setBrowserId(device); setOperationId(crypto.randomUUID());
    Promise.all([api<{ permissions: string[] }>('/auth/me'), api<Store[]>('/stores'), api<Method[]>('/sale-payment-methods'), api<LoyaltySettings>('/loyalty/settings')]).then(([me, available, paymentMethods, loyaltySettings]) => {
      setLoyalty(loyaltySettings);
      const selectedStoreId = new URLSearchParams(window.location.search).get('storeId');
      setPermissions(me.permissions); setStores(available); setStoreId(available.find(store => store.id === selectedStoreId)?.id ?? available[0]?.id ?? '');
      const active = paymentMethods.filter(method => method.active && (method.kind !== 'BONUS' || loyaltySettings.mode === 'BONUS') && (method.kind !== 'CASH' || me.permissions.includes('finance.cash_view')));
      setMethods(active); setTenders([{ key: crypto.randomUUID(), paymentMethodId: active.find(method => method.kind === 'CARD')?.id ?? active[0]?.id ?? '', amountMinor: '0', reference: '' }]);
    }).catch(caught => setError(errorMessage(caught)));
  }, []);
  useEffect(() => {
    if (!storeId || !permissions.includes('sales.view')) return;
    const saleId = new URLSearchParams(window.location.search).get('saleId');
    if (!saleId || !/^[0-9a-f-]{36}$/i.test(saleId)) return;
    let active = true;
    api<Sale>(`/stores/${storeId}/sales/${saleId}`).then(sale => {
      if (!active) return;
      setReceipt(sale);
      window.setTimeout(() => document.getElementById('sale-receipt')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    }).catch(caught => { if (active) setError(errorMessage(caught)); });
    return () => { active = false; };
  }, [storeId, permissions]);
  const load = useCallback(async () => {
    if (!storeId) return;
    try {
      const requests: Promise<unknown>[] = [permissions.includes('finance.cash_view') ? api<Page<Shift>>(`/stores/${storeId}/finance/cash-shifts?limit=100`) : Promise.resolve({ items: [] })];
      if (permissions.includes('customers.view')) requests.push(api<Page<Customer>>('/customers?limit=100'));
      const [shiftPage, customerPage] = await Promise.all(requests) as [Page<Shift>, Page<Customer> | undefined];
      setShifts(shiftPage.items.filter(shift => shift.status === 'OPEN'));
      setCustomers(customerPage?.items ?? []);
    } catch (caught) { setError(errorMessage(caught)); }
  }, [storeId, permissions]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!storeId || !search.trim()) { setProducts([]); return; } let current = true; const timer = window.setTimeout(() => { api<Page<Product>>(`/products?${queryString({ search, limit: 20 })}`).then(result => { if (current) setProducts(result.items); }).catch(caught => { if (current) setError(errorMessage(caught)); }); }, 250); return () => { current = false; window.clearTimeout(timer); }; }, [storeId, search]);
  useEffect(() => { if (!permissions.includes('customers.view')) return; let current = true; const timer = window.setTimeout(() => { api<Page<Customer>>(`/customers?${queryString({ search: customerSearch, limit: 100 })}`).then(result => { if (current) setCustomers(previous => { const selected = previous.find(customer => customer.id === customerId); return selected && !result.items.some(customer => customer.id === selected.id) ? [selected, ...result.items] : result.items; }); }).catch(caught => { if (current) setError(errorMessage(caught)); }); }, 250); return () => { current = false; window.clearTimeout(timer); }; }, [customerSearch, customerId, permissions]);
  useEffect(() => { if (!returnNotice) return; const timer = window.setTimeout(() => setReturnNotice(''), 5000); return () => window.clearTimeout(timer); }, [returnNotice]);
  useEffect(() => { if (!storeId) return; setLines([]); setReceiptDiscountValue('0'); setCashShiftId(''); setReceipt(null); setReturnNotice(''); }, [storeId]);
  useEffect(() => { if (!storeId || !deviceId || !permissions.some(permission => permission === 'sales.create' || permission === 'sales.return')) return; let active = true; setDeviceReady(false); api(`/stores/${storeId}/pos-devices`, { method: 'POST', body: JSON.stringify({ deviceId, appVersion: 'web-1' }) }).then(() => { if (active) setDeviceReady(true); }).catch(caught => { if (active) setError(errorMessage(caught)); }); return () => { active = false; }; }, [storeId, deviceId, permissions]);
  useEffect(() => { if (!deviceId) return; const shift = shifts.find(value => value.deviceId === deviceId); setCashShiftId(shift?.id ?? ''); }, [shifts, deviceId]);

  async function addProduct(product: Product) {
    if (lines.some(line => line.productId === product.id)) { setError('Товар уже в корзине'); return; }
    setBusy(true); setError('');
    try {
      const [settings, stock] = await Promise.all([api<Settings>(`/stores/${storeId}/products/${product.id}/settings`), api<Page<Stock>>(`/stores/${storeId}/stock?${queryString({ search: product.sku, limit: 20 })}`)]);
      const available = stock.items.find(item => item.productId === product.id);
      if (!settings?.active || settings.priceMinor === null) throw new Error('Нет активной цены для магазина');
      if (!available || available.quantity - available.reservedQuantity <= 0) throw new Error('Нет доступного остатка');
      setLines(current => [...current, { productId: product.id, name: product.name, sku: product.sku, brandId: product.brandId, categoryId: product.categoryId, quantity: 1, available: available.quantity - available.reservedQuantity, priceMinor: settings.priceMinor!, discountMinor: '0' }]);
      setSearch(''); setProducts([]);
    } catch (caught) { setError(errorMessage(caught)); }
    finally { setBusy(false); }
  }
  async function openShift(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { const shift = await api<Shift>(`/stores/${storeId}/finance/cash-shifts`, { method: 'POST', body: JSON.stringify({ deviceId, openingCashMinor: openingCash }) }); setShifts(current => [...current, shift]); setCashShiftId(shift.id); }
    catch (caught) { setError(errorMessage(caught)); }
    finally { setBusy(false); }
  }
  function changeQuantity(line: Line, value: string) {
    const requested = Number(value);
    if (!Number.isFinite(requested)) return;
    const quantity = Math.max(1, Math.min(Math.trunc(requested), line.available));
    setLines(current => current.map(item => item.productId === line.productId ? { ...item, quantity } : item));
    setStockNotice(requested > line.available ? `Для «${line.name}» доступно только ${line.available} шт. Количество автоматически изменено на ${line.available}.` : '');
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); setError('');
    if (!deviceReady) { setError('Устройство ещё не зарегистрировано'); return; }
    if (!totals) { setError(saleError || 'Проверьте товары и скидки'); return; }
    if (total <= 0n || tenders.length === 0 || tenders.some(tender => !validMoney(tender.amountMinor) || BigInt(tender.amountMinor) <= 0n) || tendered !== total) { setError('Сумма способов оплаты должна совпадать с итогом'); return; }
    if (tenders.some(tender => methods.find(method => method.id === tender.paymentMethodId)?.kind === 'DEBT') && !customerId) { setError('Для продажи в долг выберите клиента'); return; }
    if (bonusTendered > 0n && !selectedCustomer) { setError('Для оплаты бонусами выберите клиента'); return; }
    if (bonusTendered > BigInt(selectedCustomer?.bonusBalanceMinor ?? '0')) { setError('У клиента недостаточно бонусов'); return; }
    if (cashTender && !cashShiftId) { setError('Для наличной оплаты откройте кассовую смену'); return; }
    setBusy(true);
    try {
      const sale = await api<Sale>(`/stores/${storeId}/sales`, { method: 'POST', body: JSON.stringify({ operationId, deviceId, ...(cashTender ? { cashShiftId } : {}), ...(customerId ? { customerId } : {}), items: lines.map((line, index) => ({ productId: line.productId, quantity: line.quantity, discountMinor: totals.lines[index]!.discountMinor.toString() })), payments: tenders.map(tender => ({ paymentMethodId: tender.paymentMethodId, amountMinor: tender.amountMinor, ...(tender.reference ? { reference: tender.reference } : {}) })) }) });
      setReceipt(sale); setLines([]); setReceiptDiscountValue('0'); setStockNotice(''); setTenders(current => current.slice(0, 1).map(tender => ({ ...tender, key: crypto.randomUUID(), amountMinor: '0', reference: '' }))); setCustomerId(''); setOperationId(crypto.randomUUID()); setSalesRevision(value => value + 1); await load();
    } catch (caught) { setError(errorMessage(caught)); }
    finally { setBusy(false); }
  }

  return <CatalogShell><div className="space-y-6 crm-sales-page"><div className="flex flex-wrap items-center justify-between gap-3 print:hidden"><div className="crm-page-head"><div><span className="crm-eyebrow">ТОРГОВЛЯ</span><h1>Продажи</h1><p>Чеки, возвраты и новые продажи.</p></div></div><label>Магазин<select className="ml-2 rounded border p-2" value={storeId} onChange={event => setStoreId(event.target.value)}>{stores.map(store => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label></div>{error && <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-red-700 print:hidden">{error}</p>}{returnNotice && <p role="status" className="crm-toast rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800 shadow-lg print:hidden">{returnNotice}</p>}
    {can('sales.view') && <SalesLedger key={storeId} storeId={storeId} revision={salesRevision} onReceipt={setReceipt} deviceId={deviceId} deviceReady={deviceReady} cashShiftId={cashShiftId} canReturn={can('sales.return')} canOpenShift={can('finance.cash')} onShiftOpened={shift => { setShifts(current => [...current, shift]); setCashShiftId(shift.id); }} onReturned={sale => { setReturnNotice(`Возврат по чеку ${sale.number} оформлен`); setReceipt(sale); setSalesRevision(value => value + 1); void load(); }} />}
    {can('sales.create') && <section className="crm-sale-create space-y-5 print:hidden"><h2 className="font-semibold">Новая продажа</h2><div><label htmlFor="product-search">Поиск товара по названию, артикулу или штрихкоду</label><input id="product-search" type="search" enterKeyHint="search" autoComplete="off" className="mt-1 w-full rounded border p-2" value={search} onChange={event => setSearch(event.target.value)} /><ul className="mt-2 divide-y">{products.map(product => <li key={product.id} className="flex items-center justify-between gap-3 py-2"><span className="min-w-0">{product.name} · {product.sku}</span><button disabled={busy} onClick={() => void addProduct(product)} className="rounded border px-3 py-1">Добавить</button></li>)}</ul></div>
      <div className="overflow-x-auto"><table className="crm-mobile-cards w-full text-left text-sm"><thead><tr><th className="p-2">Товар</th><th className="p-2">Цена</th><th className="p-2">Количество</th><th className="p-2">Скидка, сомони</th><th className="p-2">Итого</th><th className="p-2"></th></tr></thead><tbody>{lines.map((line, index) => <tr key={line.productId} className="border-t"><td className="p-2">{line.name}<span className="block text-slate-500">Доступно: {line.available}</span></td><td data-label="Цена" className="p-2">{format(line.priceMinor)}</td><td data-label="Количество" className="p-2"><input aria-label={`Количество ${line.name}`} type="number" inputMode="numeric" min="1" max={line.available} className="w-20 rounded border p-1" value={line.quantity} onChange={event => changeQuantity(line, event.target.value)} /></td><td data-label="Скидка, сомони" className="p-2"><MoneyInput aria-label={`Скидка ${line.name}`} className="w-28 rounded border p-1" valueMinor={line.discountMinor} onMinorChange={minor => setLines(current => current.map(item => item.productId === line.productId ? { ...item, discountMinor: minor } : item))} /></td><td data-label="Итого" className="p-2">{totals ? format(totals.lines[index]!.totalMinor) : '—'}</td><td className="p-2"><button type="button" onClick={() => setLines(current => current.filter(item => item.productId !== line.productId))} className="underline">Убрать</button></td></tr>)}</tbody></table></div>
      <div className="grid gap-3 md:grid-cols-2"><label className="block">Поиск клиента<input className="mt-1 block w-full rounded border p-2" value={customerSearch} onChange={event => setCustomerSearch(event.target.value)} placeholder="Имя или телефон" /></label><label className="block">Клиент<select className="mt-1 block w-full rounded border p-2" value={customerId} onChange={event => setCustomerId(event.target.value)}><option value="">Без клиента</option>{customers.map(customer => <option key={customer.id} value={customer.id}>{customer.firstName} {customer.lastName ?? ''} · {customer.phone}</option>)}</select></label></div>
      {stockNotice && <p role="status" className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{stockNotice}</p>}
      {selectedCustomer && Number(selectedCustomer.discountPercent) > 0 && <p className="text-sm text-emerald-800">Персональная скидка клиента: {selectedCustomer.discountPercent}% после ручной скидки на товар.</p>}
      {selectedCustomer && loyalty?.mode === 'DISCOUNT' && Number(selectedCustomer.discountPercent) === 0 && totals && <p className="text-sm text-emerald-800">Скидка по чеку: {loyaltyPercent(loyalty, lines[0]!, '0', totals.subtotal)}%. Для разных товаров ставка может отличаться.</p>}
      {selectedCustomer && loyalty?.mode === 'BONUS' && <p className="text-sm text-slate-600">Доступно бонусов: {format(selectedCustomer.bonusBalanceMinor)}. Для оплаты бонусами добавьте способ «Бонусы».</p>}
      {bonusTendered > 0n && (!selectedCustomer || bonusTendered > BigInt(selectedCustomer.bonusBalanceMinor)) && <p role="alert" className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{!selectedCustomer ? 'Выберите клиента для оплаты бонусами.' : `Бонусов недостаточно. Доступно: ${format(selectedCustomer.bonusBalanceMinor)}.`}</p>}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-emerald-100 bg-emerald-50/50 p-4"><label className="text-sm font-medium">Скидка на весь чек<select aria-label="Вид скидки на чек" className="mt-1 block w-44 rounded border p-2" value={receiptDiscountKind} onChange={event => { setReceiptDiscountKind(event.target.value as ReceiptDiscount['kind']); setReceiptDiscountValue('0'); }}><option value="FIXED">Сумма</option><option value="PERCENT">Процент</option></select></label><label className="text-sm font-medium">{receiptDiscountKind === 'FIXED' ? 'Сумма, сомони' : 'Процент'}{receiptDiscountKind === 'FIXED' ? <MoneyInput aria-label="Размер скидки на чек" className="mt-1 block w-44 rounded border p-2" valueMinor={receiptDiscountValue} onMinorChange={setReceiptDiscountValue} placeholder="0,00" /> : <input aria-label="Размер скидки на чек" className="mt-1 block w-44 rounded border p-2" inputMode="decimal" value={receiptDiscountValue} onChange={event => setReceiptDiscountValue(event.target.value)} placeholder="0,00" />}</label>{totals && totals.receiptDiscountMinor > 0n && <p className="text-sm text-emerald-900">Скидка на чек: {format(totals.receiptDiscountMinor)}</p>}</div>
      {saleError && <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{saleError}</p>}
      <p className="text-lg font-semibold">Итого: {totals ? format(total) : '—'}</p>
      <form onSubmit={submit} className="space-y-4"><div className="space-y-2"><h3 className="font-medium">Оплата</h3>{tenders.map((tender, index) => <div key={tender.key} className="flex flex-wrap items-end gap-2"><label>Способ<select className="mt-1 block rounded border p-2" value={tender.paymentMethodId} onChange={event => setTenders(current => current.map(item => item.key === tender.key ? { ...item, paymentMethodId: event.target.value } : item))}>{methods.map(method => <option key={method.id} value={method.id}>{method.name}</option>)}</select></label><label>Сумма, сомони<MoneyInput required aria-label={`Сумма оплаты ${index + 1}`} className="mt-1 block w-40 rounded border p-2" valueMinor={tender.amountMinor} onMinorChange={minor => setTenders(current => current.map(item => item.key === tender.key ? { ...item, amountMinor: minor } : item))} /></label><label>Ссылка или номер<input className="mt-1 block rounded border p-2" value={tender.reference} onChange={event => setTenders(current => current.map(item => item.key === tender.key ? { ...item, reference: event.target.value } : item))} /></label>{index > 0 && <button type="button" onClick={() => setTenders(current => current.filter(item => item.key !== tender.key))} className="underline">Убрать</button>}</div>)}<button type="button" onClick={() => setTenders(current => [...current, { key: crypto.randomUUID(), paymentMethodId: methods[0]?.id ?? '', amountMinor: '0', reference: '' }])} className="rounded border px-3 py-2">Добавить способ</button><p>Внесено: {format(tendered)}</p></div>
      {cashTender && <div className="space-y-2 rounded border p-3"><h3 className="font-medium">Кассовая смена</h3>{shifts.find(shift => shift.deviceId === deviceId) ? <p>Смена кассы открыта</p> : <p>Нет открытой смены. Создайте её ниже.</p>}</div>}
      <button disabled={busy || !deviceReady || !storeId || !lines.length || total <= 0n || tendered !== total || (cashTender && !cashShiftId)} className="rounded bg-slate-900 px-5 py-2 text-white disabled:opacity-50">{busy ? 'Сохранение…' : 'Завершить продажу'}</button></form>{cashTender && !shifts.some(shift => shift.deviceId === deviceId) && can('finance.cash') && <form onSubmit={openShift} className="flex flex-wrap items-end gap-2 border-t pt-4"><label>Начальный остаток, сомони<MoneyInput required className="mt-1 block rounded border p-2" valueMinor={openingCash} onMinorChange={setOpeningCash} /></label><button disabled={busy || !deviceReady} className="rounded border px-4 py-2">Открыть смену</button></form>}</section>}
    {receipt && <section id="sale-receipt" className="space-y-3 rounded border bg-white p-4 print:border-0"><div className="flex items-center justify-between gap-3"><h2 className="font-semibold">Чек {receipt.number}</h2><button className="underline print:hidden" onClick={() => window.print()}>Печать</button></div>{(receipt.returns?.length ?? 0) > 0 && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-800">По чеку оформлен возврат: {format(receipt.returns.reduce((sum, item) => sum + BigInt(item.amountMinor), 0n))}</p>}<p>{new Date(receipt.createdAt).toLocaleString('ru-RU')} · {receipt.customer ? `${receipt.customer.firstName} ${receipt.customer.phone}` : 'Без клиента'}</p><ul className="divide-y">{receipt.items.map(item => <li key={item.id} className="flex justify-between py-2"><span>{item.product.name} × {item.quantity}</span><span>{format(item.totalMinor)}</span></li>)}</ul><p className="font-semibold">Итого: {format(receipt.totalMinor)}</p><p>Скидка: {format(receipt.discountMinor)}</p>{receipt.payments.map(payment => <p key={payment.id}>{payment.paymentMethod.name}: {format(payment.amountMinor)}</p>)}</section>}
  </div></CatalogShell>;
}
