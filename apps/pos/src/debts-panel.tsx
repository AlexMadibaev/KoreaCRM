import { useEffect, useState, type FormEvent } from 'react';
import type { createApiClient } from '@koreacrm/api-client';
import { MoneyInput } from '@koreacrm/ui';
import type { PosCustomer, PosPage, PosPaymentMethod, PosShift } from '@koreacrm/types';
import { formatMinor } from './calculations';

type Client = ReturnType<typeof createApiClient>;
type Props = { client: Client; storeId: string; shift: PosShift | null; methods: PosPaymentMethod[]; canPay: boolean; enabled: boolean; errorText: (caught: unknown) => string; onPaid: (cash: boolean) => Promise<void> | void };
type Draft = { operationId: string; methodId: string; amountMinor: string };
const fullName = (customer: PosCustomer) => `${customer.firstName} ${customer.lastName ?? ''}`.trim();

export function DebtsPanel({ client, storeId, shift, methods, canPay, enabled, errorText, onPaid }: Props) {
  const payMethods = methods.filter(method => method.kind !== 'DEBT' && method.kind !== 'BONUS');
  const [search, setSearch] = useState(''), [revision, setRevision] = useState(0);
  const [debtors, setDebtors] = useState<PosCustomer[]>([]), [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<PosCustomer | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');

  useEffect(() => {
    if (!enabled) { setDebtors([]); return; }
    let active = true;
    setLoading(true);
    const timer = window.setTimeout(() => {
      client.get<PosPage<PosCustomer>>(`/customers?debtors=1&limit=100${search.trim() ? `&search=${encodeURIComponent(search.trim())}` : ''}`)
        .then(page => { if (active) { setDebtors(page.items); setSelected(current => current ? page.items.find(item => item.id === current.id) ?? null : null); } })
        .catch(caught => { if (active) setError(errorText(caught)); })
        .finally(() => { if (active) setLoading(false); });
    }, search ? 250 : 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [client, enabled, search, revision, errorText]);

  function choose(customer: PosCustomer) {
    setSelected(customer); setError(''); setNotice('');
    setDraft({ operationId: crypto.randomUUID(), methodId: payMethods[0]?.id ?? '', amountMinor: customer.debtBalanceMinor ?? '0' });
  }
  const debt = BigInt(selected?.debtBalanceMinor ?? '0');
  const method = payMethods.find(value => value.id === draft?.methodId);
  const amount = draft && /^\d+$/.test(draft.amountMinor) ? BigInt(draft.amountMinor) : 0n;

  async function pay(event: FormEvent) {
    event.preventDefault();
    if (!selected || !draft || !method) return;
    if (amount <= 0n || amount > debt) { setError(`Сумма должна быть от 0,01 до ${formatMinor(debt)}.`); return; }
    if (method.kind === 'CASH' && !shift) { setError('Для приёма наличных откройте кассовую смену.'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      await client.post(`/stores/${storeId}/customers/${selected.id}/payments`, { operationId: draft.operationId, paymentMethodId: method.id, amountMinor: draft.amountMinor, ...(shift ? { cashShiftId: shift.id } : {}) });
      const left = debt - amount;
      setNotice(`Принято ${formatMinor(amount)} (${method.name}) от ${fullName(selected)}. ${left > 0n ? `Остаток долга ${formatMinor(left)}.` : 'Долг закрыт полностью.'}`);
      setDraft(null); setSelected(null); setRevision(value => value + 1);
      await onPaid(method.kind === 'CASH');
    } catch (caught) { setError(errorText(caught)); }
    finally { setBusy(false); }
  }

  return <section id="debts" className="panel debts-screen">
    <div className="screen-heading"><p className="eyebrow">КЛИЕНТЫ</p><h2>Возврат долга</h2><p>Найдите клиента и примите оплату долга целиком или частями.</p></div>
    {!enabled ? <p className="muted">Список должников доступен при связи с сервером.</p> : <>
      <label>Имя или телефон<input value={search} onChange={event => setSearch(event.target.value)} placeholder="Поиск должника" /></label>
      {error && <p role="alert" className="error">{error}</p>}
      {notice && <p role="status" className="shift-notice">{notice}</p>}
      {loading && <p className="muted" role="status">Загружаем должников…</p>}
      {!loading && !debtors.length && <p className="muted">Должников не найдено.</p>}
      <div className="debts-layout">
        <ul className="debts-list">{debtors.map(customer => <li key={customer.id} className={selected?.id === customer.id ? 'selected' : ''}><button type="button" onClick={() => choose(customer)}><span><strong>{fullName(customer)}</strong><small>{customer.phone}</small></span><strong className="debt-amount">{formatMinor(customer.debtBalanceMinor ?? '0')}</strong></button></li>)}</ul>
        {selected && draft && <form className="shift-form debts-form" onSubmit={pay}>
          <h3>{fullName(selected)}</h3>
          <p className="muted">{selected.phone} · общий долг <strong>{formatMinor(debt)}</strong> сомони</p>
          <div className="shift-cash-type" role="radiogroup" aria-label="Способ оплаты">{payMethods.map(value => <button type="button" role="radio" key={value.id} aria-checked={draft.methodId === value.id} className={draft.methodId === value.id ? 'selected' : ''} disabled={busy} onClick={() => setDraft(current => current && ({ ...current, methodId: value.id }))}>{value.name}</button>)}</div>
          <label>Сумма, сомони<MoneyInput required valueMinor={draft.amountMinor} onMinorChange={amountMinor => setDraft(current => current && ({ ...current, amountMinor }))} disabled={busy} /></label>
          <p className="shift-variance">Долг после оплаты: {formatMinor(debt - (amount > debt ? debt : amount))}</p>
          {method?.kind === 'CASH' && !shift && <p className="muted">Для приёма наличных откройте кассовую смену.</p>}
          {!canPay && <p className="muted">У вас нет права принимать оплату долга.</p>}
          <button className="primary" disabled={busy || !canPay || !method || amount <= 0n || amount > debt || (method.kind === 'CASH' && !shift)}>{busy ? 'Проводим…' : `Принять ${formatMinor(amount)}`}</button>
        </form>}
      </div>
    </>}
  </section>;
}
