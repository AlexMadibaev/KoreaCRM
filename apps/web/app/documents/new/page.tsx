'use client';

import { TypedInput, MoneyInput } from '@koreacrm/ui';
import Link from 'next/link';
import { FormEvent, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Check, Plus, Search, Trash2 } from 'lucide-react';
import { CatalogShell } from '../../../components/catalog-shell';
import { amount } from '../../../components/shift-card';
import { dushanbeDay } from '../../../components/filter-chip';
import { api, queryString, type Page } from '../../../lib/api';
import { shortDeviceCode } from '../../../lib/device-kind';

type Kind = 'PURCHASE' | 'WRITE_OFF' | 'RECEIVE_IN' | 'EXPENSE' | 'INCOME';
type Store = { id: string; name: string };
type Pick = { id: string; name: string; sku: string; unit: string; priceMinor: string | null; purchasePriceMinor: string | null; costMinor: string | null; stock: Record<string, number> };
type Line = { productId: string; name: string; sku: string; unit: string; quantity: number; priceMinor: string };
type Option = { id: string; name: string };
type OpenShift = { id: string; deviceId: string; storeId: string };
const titles: Record<Kind, string> = { PURCHASE: 'Закупка', WRITE_OFF: 'Списание', RECEIVE_IN: 'Оприходование', EXPENSE: 'Расход', INCOME: 'Приход' };
const permissionFor: Record<Kind, string> = { PURCHASE: 'purchases.create', WRITE_OFF: 'inventory.adjust', RECEIVE_IN: 'inventory.adjust', EXPENSE: 'finance.edit', INCOME: 'finance.cash' };
const unitTitle: Record<string, string> = { pcs: 'шт.', kg: 'кг', g: 'г', l: 'л', ml: 'мл', m: 'м' };
const nowLabel = () => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dushanbe' }).format(new Date());
const autoNumber = () => `З-${dushanbeDay().slice(2).replace(/-/g, '')}-${String(Date.now()).slice(-4)}`;
const errorText = (caught: unknown) => caught instanceof Error ? caught.message : 'Не удалось сохранить документ';

function Editor() {
  const params = useSearchParams();
  const router = useRouter();
  const kind = (['PURCHASE', 'WRITE_OFF', 'RECEIVE_IN', 'EXPENSE', 'INCOME'].includes(params.get('kind') ?? '') ? params.get('kind') : 'PURCHASE') as Kind;
  const [permissions, setPermissions] = useState<string[] | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [storeId, setStoreId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const allowed = permissions?.includes(permissionFor[kind]) ?? false;

  useEffect(() => {
    Promise.all([api<{ permissions: string[] }>('/auth/me'), api<Store[]>('/stores')])
      .then(([me, available]) => { setPermissions(me.permissions); setStores(available); setStoreId(current => current || available[0]?.id || ''); })
      .catch(caught => setError(errorText(caught)));
  }, []);

  return <div className="crm-doc-editor-page">
    {permissions && !allowed && <p role="alert" className="crm-alert">Нет права создавать документ «{titles[kind]}». Обратитесь к владельцу.</p>}
    {error && <p role="alert" className="crm-alert">{error}</p>}
    {kind === 'EXPENSE' || kind === 'INCOME'
      ? <ExpenseForm key={kind} income={kind === 'INCOME'} stores={stores} storeId={storeId} setStoreId={setStoreId} allowed={allowed} busy={busy} setBusy={setBusy} setError={setError} onSaved={() => router.push('/money')} />
      : <GoodsDocument key={kind} kind={kind} stores={stores} storeId={storeId} setStoreId={setStoreId} allowed={allowed} busy={busy} setBusy={setBusy} setError={setError} onSaved={() => router.push('/journal')} />}
  </div>;
}

type EditorProps = { stores: Store[]; storeId: string; setStoreId: (id: string) => void; allowed: boolean; busy: boolean; setBusy: (value: boolean) => void; setError: (value: string) => void; onSaved: () => void };

function GoodsDocument({ kind, stores, storeId, setStoreId, allowed, busy, setBusy, setError, onSaved }: EditorProps & { kind: 'PURCHASE' | 'WRITE_OFF' | 'RECEIVE_IN' }) {
  const [writeOffOperation, setWriteOffOperation] = useState(() => crypto.randomUUID());
  const [search, setSearch] = useState('');
  const [picks, setPicks] = useState<Pick[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [lineFilter, setLineFilter] = useState('');
  const [tab, setTab] = useState<'goods' | 'payment'>('goods');
  const [suppliers, setSuppliers] = useState<Option[]>([]);
  const [supplierId, setSupplierId] = useState('');
  const [number, setNumber] = useState(autoNumber);
  const [posted, setPosted] = useState(true);
  const [comment, setComment] = useState('');
  const [payNow, setPayNow] = useState(false);
  const [payMethod, setPayMethod] = useState<'CASH' | 'CARD' | 'BANK_TRANSFER'>('BANK_TRANSFER');
  const [payAmount, setPayAmount] = useState('');
  const [shifts, setShifts] = useState<OpenShift[]>([]);
  const [shiftId, setShiftId] = useState('');

  useEffect(() => { if (kind === 'PURCHASE') api<Page<Option>>('/suppliers?limit=100').then(page => { setSuppliers(page.items); setSupplierId(current => current || page.items[0]?.id || ''); }).catch(() => setSuppliers([])); }, [kind]);
  useEffect(() => {
    if (!storeId) return;
    let active = true;
    const timer = window.setTimeout(() => { api<{ items: Pick[] }>(`/products-overview?${queryString({ storeId, search: search.trim(), limit: 40, status: 'ACTIVE' })}`).then(result => { if (active) setPicks(result.items); }).catch(() => { if (active) setPicks([]); }); }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [storeId, search]);
  useEffect(() => {
    if (!storeId || kind !== 'PURCHASE') return;
    api<{ items: OpenShift[] }>(`/cash-shifts?${queryString({ storeId, status: 'OPEN', limit: 50 })}`).then(result => { setShifts(result.items); setShiftId(result.items[0]?.id ?? ''); }).catch(() => setShifts([]));
  }, [storeId, kind]);

  const add = (pick: Pick) => setLines(current => {
    const existing = current.find(line => line.productId === pick.id);
    if (existing) return current.map(line => line === existing ? { ...line, quantity: line.quantity + 1 } : line);
    return [...current, { productId: pick.id, name: pick.name, sku: pick.sku, unit: pick.unit, quantity: 1, priceMinor: (kind === 'PURCHASE' ? pick.purchasePriceMinor ?? pick.costMinor : pick.costMinor ?? pick.purchasePriceMinor)?.split('.')[0] ?? '0' }];
  });
  const total = useMemo(() => lines.reduce((sum, line) => sum + BigInt(line.priceMinor || '0') * BigInt(line.quantity), 0n).toString(), [lines]);
  const visibleLines = lines.filter(line => !lineFilter || `${line.name} ${line.sku}`.toLowerCase().includes(lineFilter.toLowerCase()));
  const update = (productId: string, patch: Partial<Line>) => setLines(current => current.map(line => line.productId === productId ? { ...line, ...patch } : line));

  // A changed document is a new operation; an unchanged one keeps its id so a retry after a network error is not posted twice.
  useEffect(() => { setWriteOffOperation(crypto.randomUUID()); }, [lines, comment, storeId]);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!lines.length) { setError('Добавьте хотя бы один товар из списка слева.'); return; }
    setBusy(true); setError('');
    try {
      if (kind === 'PURCHASE') {
        const purchase = await api<{ id: string; items: { id: string; productId: string; quantityOrdered: number }[] }>(`/stores/${storeId}/purchases`, { method: 'POST', body: JSON.stringify({ supplierId, number, items: lines.map(line => ({ productId: line.productId, quantityOrdered: line.quantity, purchasePriceMinor: line.priceMinor })) }) });
        if (posted) {
          await api(`/stores/${storeId}/purchases/${purchase.id}/submit`, { method: 'POST' });
          await api(`/stores/${storeId}/purchases/${purchase.id}/receivings`, { method: 'POST', body: JSON.stringify({ operationId: crypto.randomUUID(), items: purchase.items.map((item, index) => ({ purchaseItemId: item.id, quantity: item.quantityOrdered, batchNumber: `${number}-${index + 1}` })) }) });
          if (payNow && payAmount && payAmount !== '0') await api(`/stores/${storeId}/finance/supplier-payments`, { method: 'POST', body: JSON.stringify({ operationId: crypto.randomUUID(), purchaseId: purchase.id, amountMinor: payAmount, paymentMethod: payMethod, cashShiftId: payMethod === 'CASH' ? shiftId : undefined }) });
        }
      } else {
        // All lines are posted as one write-off document; the same operation id makes a retry safe.
        await api(`/stores/${storeId}/stock/${kind === 'WRITE_OFF' ? 'write-off-documents' : 'receive-documents'}`, { method: 'POST', body: JSON.stringify({ operationId: writeOffOperation, comment, items: lines.map(line => ({ productId: line.productId, quantity: line.quantity })) }) });
      }
      onSaved();
    } catch (caught) { setError(errorText(caught)); } finally { setBusy(false); }
  }

  return <form className="crm-doc-editor" onSubmit={save}>
    <aside className="crm-doc-picker" aria-label="Выбор товаров">
      <label className="crm-doc-picker-search"><Search size={14} aria-hidden /><span className="sr-only">Поиск товаров</span><input type="search" placeholder="Поиск товаров" value={search} onChange={event => setSearch(event.target.value)} /></label>
      <Link href="/products/new" className="crm-doc-picker-create"><Plus size={14} aria-hidden /> Создать товар</Link>
      <ul>{picks.map(pick => { const chosen = lines.some(line => line.productId === pick.id); return <li key={pick.id}><button type="button" className={["ks-control", chosen ? 'chosen' : ''].filter(Boolean).join(" ")} onClick={() => add(pick)} aria-label={`Добавить ${pick.name}`}>
        <span className="crm-doc-pick-name">{pick.name}{chosen && <Check size={14} aria-hidden />}</span>
        <span className="crm-doc-pick-meta"><span>{amount((kind === 'PURCHASE' ? pick.purchasePriceMinor : pick.priceMinor)?.split('.')[0] ?? '0')} смн.</span><span>{pick.stock[storeId] ?? 0}</span></span>
      </button></li>; })}</ul>
      {!picks.length && <p className="crm-doc-picker-empty">Товары не найдены.</p>}
    </aside>
    <section className="crm-doc-sheet">
      <div className="crm-doc-sheet-actions">
        <button type="submit" className="ks-button ks-button--primary crm-primary-button" disabled={busy || !allowed || !lines.length || (kind === 'PURCHASE' && !supplierId) || (kind !== 'PURCHASE' && comment.trim().length < 3)}>{busy ? 'Сохраняем…' : 'Сохранить'}</button>
        {kind === 'PURCHASE' && <label className="crm-doc-toggle"><input type="checkbox" checked={posted} onChange={event => setPosted(event.target.checked)} /> Документ проведён (оприходовать товар)</label>}
        <span className="crm-doc-date">{nowLabel()}</span>
      </div>
      <div className="crm-doc-title"><h1>{titles[kind]} #</h1>{kind === 'PURCHASE' && <label><span className="sr-only">Номер закупки</span><input required value={number} onChange={event => setNumber(event.target.value)} /></label>}</div>
      <div className="crm-doc-parties">
        {kind === 'PURCHASE' && <label>Поставщик<select required value={supplierId} onChange={event => setSupplierId(event.target.value)}>{!suppliers.length && <option value="">Сначала добавьте поставщика</option>}{suppliers.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
        <label>Магазин<select value={storeId} onChange={event => { setStoreId(event.target.value); setLines([]); }}>{stores.map(store => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label>
      </div>
      <div className="crm-doc-tabs" role="tablist"><button type="button" role="tab" aria-selected={tab === 'goods'} className={["ks-control", tab === 'goods' ? 'selected' : ''].filter(Boolean).join(" ")} onClick={() => setTab('goods')}>Товары</button>{kind === 'PURCHASE' && <button type="button" role="tab" aria-selected={tab === 'payment'} className={["ks-control", tab === 'payment' ? 'selected' : ''].filter(Boolean).join(" ")} onClick={() => setTab('payment')}>Счета и оплата</button>}</div>
      {tab === 'goods' ? <>
        {lines.length ? <>
          <label className="crm-doc-search"><span className="sr-only">Поиск по товарам в документе</span><input type="search" placeholder="Поиск по товарам в документе" value={lineFilter} onChange={event => setLineFilter(event.target.value)} /></label>
          <div className="crm-report-scroll"><div className="crm-table-region" role="region" aria-label="Таблица данных" tabIndex={0}><table className="crm-shift-table crm-doc-lines">
            <thead><tr><th scope="col">#</th><th scope="col">Наименование</th><th scope="col">Код товара</th><th scope="col">Ед. изм.</th><th scope="col" className="num">Кол-во</th><th scope="col" className="num">{kind === 'PURCHASE' ? 'Цена закупки, смн.' : 'Себестоимость, смн.'}</th><th scope="col" className="num">Итог</th><th scope="col"><span className="sr-only">Удалить</span></th></tr></thead>
            <tbody>{visibleLines.map(line => <tr key={line.productId}>
              <td>{lines.indexOf(line) + 1}</td><td>{line.name}</td><td>{line.sku}</td><td>{unitTitle[line.unit] ?? line.unit}</td>
              <td className="num"><TypedInput aria-label={`Количество: ${line.name}`} type="number" min={1} step={1} value={line.quantity} onChange={event => update(line.productId, { quantity: Math.max(1, Math.floor(Number(event.target.value) || 1)) })} /></td>
              <td className="num">{kind === 'PURCHASE' ? <MoneyInput aria-label={`Цена закупки: ${line.name}`} required valueMinor={line.priceMinor} onMinorChange={minor => update(line.productId, { priceMinor: minor || '0' })} /> : amount(line.priceMinor)}</td>
              <td className="num">{amount((BigInt(line.priceMinor || '0') * BigInt(line.quantity)).toString())}</td>
              <td><button type="button" className="ks-button ks-button--ghost ks-button--icon crm-icon-button" aria-label={`Удалить ${line.name}`} onClick={() => setLines(current => current.filter(item => item.productId !== line.productId))}><Trash2 size={14} aria-hidden /></button></td>
            </tr>)}</tbody>
          </table></div></div>
        </> : <p className="crm-doc-empty">← Выберите товары слева</p>}
        <dl className="crm-doc-summary"><div><dt>Итог:</dt><dd>{amount(total)} смн.</dd></div>{kind === 'PURCHASE' && <div><dt>Оплаченные:</dt><dd>{amount(payNow && posted ? payAmount || '0' : '0')} смн.</dd></div>}<div><dt>Позиций:</dt><dd>{lines.length}</dd></div></dl>
        <label className="crm-doc-comment-field">{kind === 'WRITE_OFF' ? 'Причина списания' : kind === 'RECEIVE_IN' ? 'Основание оприходования' : 'Комментарий'}<textarea required={kind !== 'PURCHASE'} minLength={kind !== 'PURCHASE' ? 3 : undefined} rows={3} value={comment} onChange={event => setComment(event.target.value)} placeholder={kind === 'WRITE_OFF' ? 'Например: повреждена упаковка' : ''} /></label>
      </> : <div className="crm-doc-payment">
        <label className="crm-doc-toggle"><input type="checkbox" checked={payNow} disabled={!posted} onChange={event => { setPayNow(event.target.checked); if (event.target.checked && !payAmount) setPayAmount(total); }} /> Оплатить поставщику сейчас</label>
        {!posted && <p>Оплата доступна для проведённой закупки: долг перед поставщиком появляется после оприходования.</p>}
        {payNow && posted && <div className="crm-doc-parties">
          <label>Счёт<select value={payMethod} onChange={event => setPayMethod(event.target.value as typeof payMethod)}><option value="BANK_TRANSFER">Расчётный счёт · перевод</option><option value="CARD">Расчётный счёт · карта</option><option value="CASH">Касса (наличные)</option></select></label>
          {payMethod === 'CASH' && <label>Смена<select required value={shiftId} onChange={event => setShiftId(event.target.value)}>{!shifts.length && <option value="">Нет открытой смены</option>}{shifts.map(shift => <option key={shift.id} value={shift.id}>Касса {shortDeviceCode(shift.deviceId)}</option>)}</select></label>}
          <label>Сумма, смн.<MoneyInput required valueMinor={payAmount} onMinorChange={setPayAmount} /></label>
        </div>}
      </div>}
    </section>
  </form>;
}

function ExpenseForm({ income = false, stores, storeId, setStoreId, allowed, busy, setBusy, setError, onSaved }: EditorProps & { income?: boolean }) {
  const [incomeCategory, setIncomeCategory] = useState('Внесение наличных');
  const [operationId, setOperationId] = useState(() => crypto.randomUUID());
  const [categories, setCategories] = useState<Option[]>([]);
  const [categoryId, setCategoryId] = useState('');
  const [shifts, setShifts] = useState<OpenShift[]>([]);
  const [account, setAccount] = useState('');
  const [amountMinor, setAmountMinor] = useState('');
  const [date, setDate] = useState(dushanbeDay());
  const [description, setDescription] = useState('');
  const loadShifts = useCallback(() => {
    if (!storeId) return;
    api<{ items: OpenShift[] }>(`/cash-shifts?${queryString({ storeId, status: 'OPEN', limit: 50 })}`).then(result => { setShifts(result.items); setAccount(current => current || (result.items[0] ? `CASH:${result.items[0].id}` : income ? '' : 'BANK_TRANSFER')); }).catch(() => { setShifts([]); setAccount(income ? '' : 'BANK_TRANSFER'); });
  }, [storeId, income]);
  useEffect(() => { api<Option[]>('/expense-categories').then(items => { setCategories(items); setCategoryId(current => current || items[0]?.id || ''); }).catch(() => setCategories([])); }, []);
  useEffect(() => { setAccount(''); loadShifts(); }, [loadShifts]);
  useEffect(() => { setOperationId(crypto.randomUUID()); }, [storeId, account, amountMinor, categoryId, incomeCategory, date, description]);
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const [method, shiftId] = account.split(':');
      if (income) {
        // Cash only: a receipt goes into the drawer of an open shift and shows up in the shift and in "Движение денег".
        await api(`/stores/${storeId}/finance/cash-shifts/${shiftId}/operations`, { method: 'POST', body: JSON.stringify({ operationId, type: 'DEPOSIT', amountMinor, comment: `${incomeCategory.trim()}${description.trim() ? `: ${description.trim()}` : ''}` }) });
        onSaved();
        return;
      }
      await api(`/stores/${storeId}/finance/expenses`, { method: 'POST', body: JSON.stringify({ operationId, categoryId, amountMinor, paymentMethod: method, cashShiftId: method === 'CASH' ? shiftId : undefined, date, description: description || undefined }) });
      onSaved();
    } catch (caught) { setError(errorText(caught)); } finally { setBusy(false); }
  }
  return <form className="crm-doc-sheet crm-expense-form" onSubmit={save}>
    <div className="crm-doc-sheet-actions"><button type="submit" className="ks-button ks-button--primary crm-primary-button" disabled={busy || !allowed || !amountMinor || amountMinor === '0' || (income ? !incomeCategory.trim() || !account.startsWith('CASH:') : !categoryId) || !account}>{busy ? 'Сохраняем…' : 'Сохранить'}</button><span className="crm-doc-date">{nowLabel()}</span></div>
    <div className="crm-doc-title"><h1>{income ? 'Приход' : 'Расход'} #</h1></div>
    <div className="crm-doc-parties">
      <label>Магазин<select value={storeId} onChange={event => setStoreId(event.target.value)}>{stores.map(store => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label>
      <label>Счёт *<select required value={account} onChange={event => setAccount(event.target.value)}>{shifts.map(shift => <option key={shift.id} value={`CASH:${shift.id}`}>Касса {shortDeviceCode(shift.deviceId)} (смена открыта)</option>)}{!income && <option value="BANK_TRANSFER">Расчётный счёт · перевод</option>}{!income && <option value="CARD">Расчётный счёт · карта</option>}</select></label>
      {income ? <label>Категория платежа *<input required list="income-categories" value={incomeCategory} onChange={event => setIncomeCategory(event.target.value)} /><datalist id="income-categories"><option value="Внесение наличных" /><option value="Размен" /><option value="Возврат подотчётных денег" /><option value="Прочий приход" /></datalist></label> : <label>Категория платежа *<select required value={categoryId} onChange={event => setCategoryId(event.target.value)}>{!categories.length && <option value="">Нет категорий</option>}{categories.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
      <label>Сумма, смн. *<MoneyInput required valueMinor={amountMinor} onMinorChange={setAmountMinor} /></label>
      {!income && <label>Дата<input type="date" required value={date} max={dushanbeDay()} onChange={event => setDate(event.target.value)} /></label>}
    </div>
    {!shifts.length && <p className="crm-doc-hint">{income ? 'Приход наличных принимается только в кассу с открытой сменой.' : 'Наличными можно заплатить только из открытой смены.'} <Link href="/cash-shifts">Открыть смену</Link></p>}
    <label className="crm-doc-comment-field">Комментарий<textarea rows={4} value={description} onChange={event => setDescription(event.target.value)} /></label>
    {!income && <p className="crm-doc-hint"><Link href="/finance/categories">Категории расходов</Link></p>}
  </form>;
}

export default function NewDocumentPage() {
  return <CatalogShell><Suspense fallback={<p role="status">Загружаем форму…</p>}><Editor /></Suspense></CatalogShell>;
}
