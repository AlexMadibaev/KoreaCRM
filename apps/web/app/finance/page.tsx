'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Pencil, Plus, ReceiptText, Search, Trash2, X } from 'lucide-react';
import styles from './expenses.module.css';
import { CatalogShell } from '../../components/catalog-shell';
import { api, queryString, type Page } from '../../lib/api';
import { formatCurrencyMinor as money, MoneyInput } from '@koreacrm/ui';

type Store = { id: string; name: string };
type Category = { id: string; name: string };
type Shift = { id: string; deviceId: string; status: 'OPEN' | 'CLOSED'; openingCashMinor: string; expectedCashMinor: string; actualCashMinor: string | null; openedAt: string };
type ExpenseStatus = 'PAID' | 'UNPAID';
type Expense = { id: string; categoryId: string; recipientName: string | null; paymentStatus?: ExpenseStatus; amountMinor: string; paymentMethod: string; date: string; description: string | null; category: { name: string } };
type Payment = { id: string; amountMinor: string; paymentMethod: string; createdAt: string; supplier: { name: string }; purchase: { number: string } };
type Purchase = { id: string; number: string; debtMinor: string; supplier: { name: string } };
type Summary = { expensesMinor: string; cashDrawerFlowMinor: string; cashFlowMinor: string | null; supplierDebtMinor: string; supplierPaymentsMinor: string; openCashMinor: string; revenueMinor: string | null; cogsMinor: string | null; grossProfitMinor: string | null; operationalResultMinor: string | null; customerDebtMinor: string | null; salesMetricsAvailable: boolean };
type Method = 'CASH' | 'CARD' | 'BANK_TRANSFER';
const expenseStatuses: { value: ExpenseStatus; label: string }[] = [{ value: 'UNPAID', label: 'Не оплачено' }, { value: 'PAID', label: 'Оплачено' }];
const localDate = () => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; };
const errorText = (caught: unknown) => caught instanceof Error ? caught.message : 'Операция не выполнена';
const methods: { value: Method; label: string }[] = [{ value: 'CASH', label: 'Наличные' }, { value: 'CARD', label: 'Карта' }, { value: 'BANK_TRANSFER', label: 'Банковский перевод' }];

export default function FinancePage() {
  const loadVersion = useRef(0);
  const [permissions, setPermissions] = useState<string[]>([]), [stores, setStores] = useState<Store[]>([]), [storeId, setStoreId] = useState('');
  const [categories, setCategories] = useState<Category[]>([]), [shifts, setShifts] = useState<Shift[]>([]), [expenses, setExpenses] = useState<Expense[]>([]), [payments, setPayments] = useState<Payment[]>([]), [purchases, setPurchases] = useState<Purchase[]>([]), [summary, setSummary] = useState<Summary | null>(null);
  const [from, setFrom] = useState(localDate), [to, setTo] = useState(localDate), [error, setError] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
  const [expenseCategoryId, setExpenseCategoryId] = useState(''), [expenseAmount, setExpenseAmount] = useState(''), [expenseMethod, setExpenseMethod] = useState<Method>('CASH'), [expenseShiftId, setExpenseShiftId] = useState(''), [expenseDescription, setExpenseDescription] = useState(''), [expenseDate, setExpenseDate] = useState(localDate), [expenseOperationId, setExpenseOperationId] = useState('');
  const [canManageExpenseStatus, setCanManageExpenseStatus] = useState(false);
  const [expenseStatusFilter, setExpenseStatusFilter] = useState<ExpenseStatus | ''>('');
  const [expenseStatus, setExpenseStatus] = useState<ExpenseStatus>('UNPAID');
  const [expenseRecipient, setExpenseRecipient] = useState('');
  const [editedExpense, setEditedExpense] = useState<Expense | null>(null);
  const [expenseFormOpen, setExpenseFormOpen] = useState(false);
  const [expenseSearch, setExpenseSearch] = useState('');
  const [expenseTotal, setExpenseTotal] = useState(0);
  const expenseDialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = expenseDialog.current;
    if (expenseFormOpen && dialog && !dialog.open) dialog.showModal();
    if (!expenseFormOpen && dialog?.open) dialog.close();
  }, [expenseFormOpen]);
  const [paymentPurchaseId, setPaymentPurchaseId] = useState(''), [paymentAmount, setPaymentAmount] = useState(''), [paymentMethod, setPaymentMethod] = useState<Method>('BANK_TRANSFER'), [paymentShiftId, setPaymentShiftId] = useState(''), [paymentOperationId, setPaymentOperationId] = useState('');
  const can = (permission: string) => permissions.includes(permission);
  const shiftJumpDone = useRef(false);
  useEffect(() => {
    // Old links to the shift block now lead to the dedicated shift journal.
    if (shiftJumpDone.current || window.location.hash !== '#cash-shifts') return;
    shiftJumpDone.current = true;
    const store = new URLSearchParams(window.location.search).get('storeId');
    window.location.replace(`/cash-shifts${store ? `?storeId=${encodeURIComponent(store)}` : ''}`);
  }, []);
  useEffect(() => { Promise.all([api<{ permissions: string[] }>('/auth/me'), api<Store[]>('/finance/stores')]).then(([me, available]) => { setPermissions(me.permissions); setStores(available); setStoreId(available.find(store => store.id === new URLSearchParams(window.location.search).get('storeId'))?.id ?? available[0]?.id ?? ''); setPaymentOperationId(crypto.randomUUID()); setExpenseOperationId(crypto.randomUUID()); }).catch((caught) => { setError(errorText(caught)); setLoading(false); }); }, []);
  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    if (!storeId || !permissions.length) { setLoading(false); return; }
    setLoading(true);
    try {
      const shiftPage = await api<Page<Shift>>(`/stores/${storeId}/finance/cash-shifts?limit=100`);
      if (version !== loadVersion.current) return;
      setShifts(shiftPage.items);
      const openShift = shiftPage.items.find((shift) => shift.status === 'OPEN')?.id ?? '';
      setExpenseShiftId((old) => old || openShift); setPaymentShiftId((old) => old || openShift);
      if (permissions.includes('finance.view')) {
        const [categoryItems, expensePage, paymentPage, purchasePage, report] = await Promise.all([
          api<Category[]>('/expense-categories'),
          api<Page<Expense> & { canManagePaymentStatus: boolean }>(`/stores/${storeId}/finance/expenses?limit=100${expenseStatusFilter ? `&paymentStatus=${expenseStatusFilter}` : ''}`),
          api<Page<Payment>>(`/stores/${storeId}/finance/supplier-payments?limit=100`),
          permissions.includes('finance.supplier_pay') ? api<Page<Purchase>>(`/stores/${storeId}/purchases?limit=100`) : Promise.resolve({ items: [], total: 0, page: 1, limit: 100 }),
          api<Summary>(`/finance/summary?${queryString({ from, to, storeId })}`),
        ]);
        if (version !== loadVersion.current) return;
        setCategories(categoryItems); setExpenses(expensePage.items); setExpenseTotal(expensePage.total); setCanManageExpenseStatus(expensePage.canManagePaymentStatus); setPayments(paymentPage.items); setPurchases(purchasePage.items); setSummary(report);
        setExpenseCategoryId((old) => old || categoryItems[0]?.id || '');
      }
    } catch (caught) { if (version === loadVersion.current) setError(errorText(caught)); } finally { if (version === loadVersion.current) setLoading(false); }
  }, [storeId, permissions, from, to, expenseStatusFilter]);
  useEffect(() => { void load(); }, [load]);
  async function mutate(task: () => Promise<unknown>) { setBusy(true); setError(''); try { await task(); await load(); } catch (caught) { setError(errorText(caught)); } finally { setBusy(false); } }
  function resetExpenseForm() {
    setExpenseFormOpen(false);
    setEditedExpense(null);
    setExpenseCategoryId(categories[0]?.id ?? '');
    setExpenseAmount('');
    setExpenseDescription('');
    setExpenseRecipient('');
    setExpenseStatus('UNPAID');
    setExpenseDate(localDate());
    setExpenseOperationId(crypto.randomUUID());
  }

  function editExpense(expense: Expense) {
    setError('');
    setEditedExpense(expense);
    setExpenseFormOpen(true);
    setExpenseCategoryId(expense.categoryId);
    setExpenseAmount(expense.amountMinor);
    setExpenseDate(expense.date.slice(0, 10));
    setExpenseDescription(expense.description ?? '');
    setExpenseRecipient(expense.recipientName ?? '');
    setExpenseStatus(expense.paymentStatus ?? 'UNPAID');
  }

  async function addExpense(event: FormEvent) {
    event.preventDefault();
    await mutate(async () => {
      const url = `/stores/${storeId}/finance/expenses`;
      const fields = {
        categoryId: expenseCategoryId,
        amountMinor: expenseAmount,
        description: expenseDescription,
        recipientName: expenseRecipient,
        date: expenseDate,
        paymentStatus: canManageExpenseStatus ? expenseStatus : undefined,
      };
      if (editedExpense) {
        await api(`${url}/${editedExpense.id}`, { method: 'PATCH', body: JSON.stringify(fields) });
      } else {
        await api(url, { method: 'POST', body: JSON.stringify({
          ...fields, operationId: expenseOperationId, paymentMethod: expenseMethod,
          cashShiftId: expenseMethod === 'CASH' ? expenseShiftId : undefined,
        }) });
      }
      resetExpenseForm();
    });
  }

  async function deleteExpense(expense: Expense) {
    if (!window.confirm('Удалить эту запись расхода?')) return;
    await mutate(async () => {
      await api(`/stores/${storeId}/finance/expenses/${expense.id}`, { method: 'DELETE' });
      if (editedExpense?.id === expense.id) resetExpenseForm();
    });
  }

  async function changeExpenseStatus(expense: Expense, paymentStatus: ExpenseStatus) {
    await mutate(async () => {
      await api(`/stores/${storeId}/finance/expenses/${expense.id}`, { method: 'PATCH', body: JSON.stringify({ paymentStatus }) });
      if (editedExpense?.id === expense.id) setExpenseStatus(paymentStatus);
    });
  }
  async function paySupplier(event: FormEvent) { event.preventDefault(); await mutate(async () => { await api(`/stores/${storeId}/finance/supplier-payments`, { method: 'POST', body: JSON.stringify({ operationId: paymentOperationId, purchaseId: paymentPurchaseId, amountMinor: paymentAmount, paymentMethod, cashShiftId: paymentMethod === 'CASH' ? paymentShiftId : undefined }) }); setPaymentOperationId(crypto.randomUUID()); setPaymentAmount(''); }); }
  const search = expenseSearch.trim().toLocaleLowerCase('ru');
  const visibleExpenses = expenses.filter(expense =>
    !search || [expense.category.name, expense.recipientName, expense.description]
      .some(value => value?.toLocaleLowerCase('ru').includes(search)),
  );
  const openShifts = shifts.filter((shift) => shift.status === 'OPEN');
  return <CatalogShell><div className="crm-screen "><div className="crm-page-head"><div><span className="crm-eyebrow">АНАЛИТИКА</span><h1>Финансы</h1><p>Выручка, расходы и оплаты поставщикам. Все суммы указаны в сомони.</p></div></div>{error && <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-red-700">{error}</p>}<label className="block">Магазин<select className="ml-2 rounded border p-2" value={storeId} onChange={(event) => { loadVersion.current++; setStoreId(event.target.value); setSummary(null); setExpenseShiftId(''); setPaymentShiftId(''); setShifts([]); resetExpenseForm(); setExpenseStatusFilter(''); setCanManageExpenseStatus(false); setExpenses([]); setExpenseTotal(0); setExpenseSearch(''); setPayments([]); setPurchases([]); setPaymentPurchaseId(''); setPaymentOperationId(crypto.randomUUID()); setExpenseOperationId(crypto.randomUUID()); }}><option value="">Выберите</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label>{loading && <p>Загрузка…</p>}
    {can('finance.view') && <section className="space-y-3 rounded border bg-white p-4"><h2 className="text-xl font-semibold">Финансовая сводка</h2><p className="text-sm text-slate-500">Период считается по UTC. Суммы указаны в сомони.</p><div className="flex flex-wrap gap-3"><label>С<input type="date" className="ml-2 rounded border p-2" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label>По<input type="date" className="ml-2 rounded border p-2" value={to} onChange={(event) => setTo(event.target.value)} /></label></div>{summary && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{([['Выручка', summary.revenueMinor], ['Себестоимость', summary.cogsMinor], ['Валовая прибыль', summary.grossProfitMinor], ['Результат после расходов', summary.operationalResultMinor], ['Долг покупателей сейчас', summary.customerDebtMinor], ['Расходы', summary.expensesMinor], ['Движение кассы', summary.cashDrawerFlowMinor], ['Долг поставщикам сейчас', summary.supplierDebtMinor], ['Оплаты поставщикам', summary.supplierPaymentsMinor], ['Открытая наличность', summary.openCashMinor]] as const).map(([label, value]) => <div key={label} className="rounded bg-slate-50 p-3"><span className="block text-sm text-slate-500">{label}</span><strong>{money(value)}</strong></div>)}</div>}<p className="text-sm text-slate-500">Полный денежный поток пока не рассчитан. Долг покупателей показывается только для всех магазинов вместе.</p></section>}
    {can('finance.cash_view') && <section id="cash-shifts" className="space-y-2 rounded border bg-white p-4"><h2 className="text-xl font-semibold">Кассовые смены</h2><p>Журнал смен, открытие и закрытие смены, внесения и изъятия теперь в разделе «Кассы и смены → Смены».</p><a className="ks-button ks-button--secondary crm-outline-button" href={`/cash-shifts${storeId ? `?storeId=${encodeURIComponent(storeId)}` : ''}`}>Открыть смены</a></section>}
    {can('finance.view') && <section className={styles.panel} aria-labelledby="expenses-heading" aria-busy={loading}>
      <header className={styles.header}>
        <div className={styles.title}>
          <span className={styles.emblem}><ReceiptText size={22} aria-hidden="true" /></span>
          <div><h2 id="expenses-heading">Расходы</h2><p>{expenseTotal.toLocaleString('ru-RU')} записей по текущему фильтру</p></div>
        </div>
        {can('finance.edit') && <div className={styles.actions}>
          <a href="/finance/categories" className="ks-button ks-button--secondary">Категории</a>
          <button type="button" className="ks-button ks-button--primary" disabled={!storeId || busy} onClick={() => {
            setError('');
            resetExpenseForm();
            setExpenseFormOpen(true);
          }}><Plus size={17} aria-hidden="true" /> Добавить расход</button>
        </div>}
      </header>

      <div className={styles.toolbar}>
        <label className={styles.search}>
          <Search size={17} aria-hidden="true" />
          <input aria-label="Поиск расходов" type="search" placeholder="Получатель, категория или заметка" value={expenseSearch} onChange={event => setExpenseSearch(event.target.value)} />
        </label>
        {canManageExpenseStatus && <div className={styles.filters} role="group" aria-label="Фильтр по статусу оплаты">
          {[{ value: '' as const, label: 'Все' }, ...expenseStatuses.slice().reverse()].map(status => (
            <button type="button" key={status.value} aria-pressed={expenseStatusFilter === status.value} disabled={busy} onClick={() => setExpenseStatusFilter(status.value)}>{status.label}</button>
          ))}
        </div>}
      </div>

      {!visibleExpenses.length ? <div className={styles.empty} role="status">
        <ReceiptText size={28} aria-hidden="true" />
        <strong>{loading ? 'Загружаем расходы…' : search || expenseStatusFilter ? 'Расходы не найдены' : 'Расходов пока нет'}</strong>
        {!loading && (search || expenseStatusFilter) && <button type="button" className="ks-button ks-button--secondary" onClick={() => { setExpenseSearch(''); setExpenseStatusFilter(''); }}>Сбросить фильтры</button>}
      </div> : <ul className={styles.list}>
        {visibleExpenses.map(expense => {
          const title = expense.recipientName || expense.category.name;
          return <li className={styles.row} key={expense.id}>
            <div className={styles.record}>
              <strong>{title}</strong>
              <span>{expense.recipientName && `${expense.category.name} · `}{new Date(expense.date).toLocaleDateString('ru-RU', { timeZone: 'UTC' })} · {methods.find(method => method.value === expense.paymentMethod)?.label ?? expense.paymentMethod}</span>
              {expense.description && <p>{expense.description}</p>}
            </div>
            <strong className={styles.amount}>{money(expense.amountMinor)}</strong>
            <div className={styles.rowActions}>
              {canManageExpenseStatus && expense.paymentStatus && <select
                aria-label={`Статус оплаты: ${title}`}
                className={styles.status}
                data-status={expense.paymentStatus}
                value={expense.paymentStatus}
                disabled={busy || loading}
                onChange={event => void changeExpenseStatus(expense, event.target.value as ExpenseStatus)}
              >{expenseStatuses.map(status => <option key={status.value} value={status.value}>{status.label}</option>)}</select>}
              {can('finance.edit') && <>
                <button type="button" className={styles.iconButton} disabled={busy} title="Изменить" aria-label={`Изменить расход: ${title}`} onClick={() => editExpense(expense)}><Pencil size={17} aria-hidden="true" /></button>
                <button type="button" className={styles.iconButton} data-danger disabled={busy} title="Удалить" aria-label={`Удалить расход: ${title}`} onClick={() => void deleteExpense(expense)}><Trash2 size={17} aria-hidden="true" /></button>
              </>}
            </div>
          </li>;
        })}
      </ul>}
      {expenseTotal > expenses.length && <p className={styles.limit}>Показаны последние {expenses.length} записей. Поиск выполняется по этому списку.</p>}

      {can('finance.edit') && <dialog ref={expenseDialog} className={styles.dialog} aria-labelledby="expense-form-heading" onCancel={event => { event.preventDefault(); if (!busy) resetExpenseForm(); }}>
        {expenseFormOpen && <form onSubmit={addExpense}>
          <header className={styles.dialogHeader}>
            <h3 id="expense-form-heading">{editedExpense ? 'Редактировать расход' : 'Новый расход'}</h3>
            <button type="button" className={styles.iconButton} aria-label="Закрыть" disabled={busy} onClick={resetExpenseForm}><X size={20} aria-hidden="true" /></button>
          </header>
          {error && <p role="alert" className={styles.error}>{error}</p>}
          <fieldset className={styles.fields} disabled={busy}>
            <label>Сумма, сомони<MoneyInput required valueMinor={expenseAmount} onMinorChange={minor => { setExpenseAmount(minor); setExpenseOperationId(crypto.randomUUID()); }} /></label>
            <label>Дата<input required type="date" value={expenseDate} onChange={event => { setExpenseDate(event.target.value); setExpenseOperationId(crypto.randomUUID()); }} /></label>
            <label>Категория<select required value={expenseCategoryId} onChange={event => { setExpenseCategoryId(event.target.value); setExpenseOperationId(crypto.randomUUID()); }}>
              <option value="">Выберите категорию</option>
              {editedExpense && !categories.some(category => category.id === editedExpense.categoryId) && <option value={editedExpense.categoryId}>{editedExpense.category.name}</option>}
              {categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select></label>
            <label>Получатель<input maxLength={120} placeholder="Имя сотрудника или получателя" value={expenseRecipient} onChange={event => { setExpenseRecipient(event.target.value); setExpenseOperationId(crypto.randomUUID()); }} /></label>
            {!editedExpense && <>
              <label>Способ оплаты<select value={expenseMethod} onChange={event => { setExpenseMethod(event.target.value as Method); setExpenseOperationId(crypto.randomUUID()); }}>{methods.map(method => <option key={method.value} value={method.value}>{method.label}</option>)}</select></label>
              {expenseMethod === 'CASH' && <label>Кассовая смена<select required value={expenseShiftId} onChange={event => { setExpenseShiftId(event.target.value); setExpenseOperationId(crypto.randomUUID()); }}>
                <option value="">{openShifts.length ? 'Выберите смену' : 'Нет открытых смен'}</option>
                {openShifts.map(shift => <option key={shift.id} value={shift.id}>{shift.deviceId}</option>)}
              </select></label>}
            </>}
            {canManageExpenseStatus && <label>Статус оплаты<select value={expenseStatus} onChange={event => { setExpenseStatus(event.target.value as ExpenseStatus); setExpenseOperationId(crypto.randomUUID()); }}>{expenseStatuses.map(status => <option key={status.value} value={status.value}>{status.label}</option>)}</select></label>}
            <label className={styles.note}>Заметка<textarea rows={3} maxLength={1000} placeholder="За что или за какой период" value={expenseDescription} onChange={event => { setExpenseDescription(event.target.value); setExpenseOperationId(crypto.randomUUID()); }} /></label>
          </fieldset>
          <footer className={styles.dialogFooter}>
            <button type="button" className="ks-button ks-button--secondary" disabled={busy} onClick={resetExpenseForm}>Отмена</button>
            <button type="submit" className="ks-button ks-button--primary" disabled={busy || !storeId}>{busy ? 'Сохраняем…' : editedExpense ? 'Сохранить изменения' : 'Записать расход'}</button>
          </footer>
        </form>}
      </dialog>}
    </section>}
    {can('finance.view') && <section className="space-y-3 rounded border bg-white p-4"><h2 className="text-xl font-semibold">Оплаты поставщикам</h2>{can('finance.supplier_pay') && <form onSubmit={paySupplier} className="flex flex-wrap items-end gap-3"><label>Закупка<select required className="mt-1 block rounded border p-2" value={paymentPurchaseId} onChange={(event) => { setPaymentPurchaseId(event.target.value); setPaymentOperationId(crypto.randomUUID()); setExpenseOperationId(crypto.randomUUID()); }}><option value="">Выберите</option>{purchases.filter((purchase) => purchase.debtMinor !== '0').map((purchase) => <option key={purchase.id} value={purchase.id}>{purchase.number} · {purchase.supplier.name} · долг {money(purchase.debtMinor)}</option>)}</select></label><label>Сумма<MoneyInput required className="mt-1 block rounded border p-2" valueMinor={paymentAmount} onMinorChange={(minor) => { setPaymentAmount(minor); setPaymentOperationId(crypto.randomUUID()); }} /></label><label>Способ<select className="mt-1 block rounded border p-2" value={paymentMethod} onChange={(event) => { setPaymentMethod(event.target.value as Method); setPaymentOperationId(crypto.randomUUID()); }}>{methods.map((method) => <option key={method.value} value={method.value}>{method.label}</option>)}</select></label>{paymentMethod === 'CASH' && <label>Кассовая смена<select required className="mt-1 block rounded border p-2" value={paymentShiftId} onChange={(event) => { setPaymentShiftId(event.target.value); setPaymentOperationId(crypto.randomUUID()); setExpenseOperationId(crypto.randomUUID()); }}><option value="">Выберите</option>{openShifts.map((shift) => <option key={shift.id} value={shift.id}>{shift.deviceId}</option>)}</select></label>}<button disabled={busy || !paymentPurchaseId} className="ks-button ks-button--primary">Оплатить</button></form>}<div className="overflow-x-auto"><table className="crm-mobile-cards w-full text-left text-sm"><thead><tr><th className="p-2">Дата</th><th className="p-2">Поставщик</th><th className="p-2">Закупка</th><th className="p-2">Сумма</th><th className="p-2">Способ</th></tr></thead><tbody>{payments.map((payment) => <tr key={payment.id} className="border-t"><td data-label="Дата" className="p-2">{new Date(payment.createdAt).toLocaleString('ru-RU')}</td><td data-label="Поставщик" className="p-2">{payment.supplier.name}</td><td data-label="Закупка" className="p-2">{payment.purchase.number}</td><td data-label="Сумма" className="p-2">{money(payment.amountMinor)}</td><td data-label="Способ" className="p-2">{payment.paymentMethod}</td></tr>)}</tbody></table></div></section>}
  </div></CatalogShell>;
}
