import { useState } from 'react';
import { MoneyInput } from '@koreacrm/ui';
import type { PosCustomer, PosPaymentMethod } from '@koreacrm/types';
import { formatMinor } from './calculations';
import { Icon, Kbd, Modal, useOverlayKeys } from './cloud-ui';

export type PaymentPart = { methodId: string; kind: PosPaymentMethod['kind']; name: string; amountMinor: bigint; reference: string };
type Totals = { subtotal: bigint; discount: bigint; total: bigint };
const bills = [500n, 1000n, 2000n, 5000n, 10000n].map(value => value * 100n);
const initials = (customer: PosCustomer) => `${customer.firstName[0] ?? ''}${customer.lastName?.[0] ?? ''}`.toUpperCase();
const cardReference = (rrn: string, last4: string) => [rrn ? `RRN ${rrn}` : '', last4 ? `карта *${last4}` : ''].filter(Boolean).join(' · ');
const whole = (minor: bigint) => minor % 100n === 0n ? new Intl.NumberFormat('ru-RU').format(minor / 100n) : formatMinor(minor);
const methodIcon = (kind: PosPaymentMethod['kind']) => kind === 'CASH' ? 'cash' : kind === 'DEBT' ? 'handshake' : kind === 'BONUS' ? 'gift' : 'card';

/** Cash suggestions: the exact remainder, the next round hundred, then banknotes above it. */
export function cashOptions(remaining: bigint): bigint[] {
  if (remaining <= 0n) return [];
  const hundred = 10000n;
  const rounded = (remaining + hundred - 1n) / hundred * hundred;
  return [...new Set([remaining, rounded, ...bills.filter(bill => bill > rounded)])].slice(0, 7);
}

/** Adds a payment; cash above the remainder becomes change instead of a payment. */
export function acceptPart(parts: PaymentPart[], part: PaymentPart, total: bigint): { parts: PaymentPart[]; change: bigint } {
  const remaining = total - parts.reduce((sum, value) => sum + value.amountMinor, 0n);
  const take = part.amountMinor > remaining ? remaining : part.amountMinor;
  const change = part.kind === 'CASH' ? part.amountMinor - take : 0n;
  if (take <= 0n) return { parts, change };
  const existing = parts.find(value => value.methodId === part.methodId);
  const next = existing ? parts.map(value => value === existing ? { ...value, amountMinor: value.amountMinor + take, reference: [value.reference, part.reference].filter(Boolean).join('; ') } : value) : [...parts, { ...part, amountMinor: take }];
  return { parts: next, change };
}

export function PaymentScreen({ totals, methods, customer, shiftOpen, busy, printDefault, onChangeCustomer, onComplete, onClose }: { totals: Totals; methods: PosPaymentMethod[]; customer: PosCustomer | null; shiftOpen: boolean; busy: boolean; printDefault: boolean; onChangeCustomer: () => void; onComplete: (parts: PaymentPart[], change: bigint, print: boolean, comment: string) => void; onClose: () => void }) {
  const [parts, setParts] = useState<PaymentPart[]>([]);
  const [change, setChange] = useState(0n);
  const [methodId, setMethodId] = useState(methods[0]?.id ?? '');
  const accepted = parts.reduce((sum, part) => sum + part.amountMinor, 0n);
  const remaining = totals.total - accepted;
  const [amount, setAmount] = useState(totals.total.toString());
  const [showTotals, setShowTotals] = useState(false);
  const [print, setPrint] = useState(printDefault);
  const [comment, setComment] = useState('');
  const [terminal, setTerminal] = useState<{ amount: bigint } | null>(null);
  const [rrn, setRrn] = useState(''), [last4, setLast4] = useState('');
  const [error, setError] = useState('');
  const method = methods.find(value => value.id === methodId);
  const value = /^\d+$/.test(amount) ? BigInt(amount) : 0n;
  const bonusUsed = parts.filter(part => part.kind === 'BONUS').reduce((sum, part) => sum + part.amountMinor, 0n);
  const debtBefore = BigInt(customer?.debtBalanceMinor ?? '0');
  const debtAfter = debtBefore + parts.filter(part => part.kind === 'DEBT').reduce((sum, part) => sum + part.amountMinor, 0n) + (method?.kind === 'DEBT' ? value : 0n);

  function problem(): string {
    if (!method) return 'Выберите способ оплаты.';
    if (value <= 0n) return 'Введите сумму.';
    if (method.kind !== 'CASH' && value > remaining) return `Сумма больше остатка ${formatMinor(remaining)}.`;
    if (method.kind === 'CASH' && !shiftOpen) return 'Для наличных откройте смену.';
    if (method.kind === 'DEBT' && !customer) return 'Отсрочка доступна только с клиентом. Нажмите «Изменить» и выберите клиента.';
    if (method.kind === 'BONUS' && (!customer || value + bonusUsed > BigInt(customer.bonusBalanceMinor ?? '0'))) return 'Недостаточно бонусов у клиента.';
    return '';
  }
  function add(part: PaymentPart) {
    const result = acceptPart(parts, part, totals.total);
    const nextChange = change + result.change;
    setParts(result.parts); setChange(nextChange); setError('');
    const left = totals.total - result.parts.reduce((sum, item) => sum + item.amountMinor, 0n);
    setAmount(left.toString());
    if (left === 0n) onComplete(result.parts, nextChange, print, comment.trim());
  }
  function accept() {
    if (busy) return;
    // Everything is already paid but the sale was not saved: send it again.
    if (remaining === 0n && parts.length) { onComplete(parts, change, print, comment.trim()); return; }
    const reason = problem();
    if (reason) { setError(reason); return; }
    if (method!.kind === 'CARD') { setTerminal({ amount: value }); return; }
    add({ methodId: method!.id, kind: method!.kind, name: method!.name, amountMinor: value, reference: '' });
  }
  function remove(part: PaymentPart) {
    const next = parts.filter(item => item !== part);
    setParts(next); setChange(0n); setAmount((totals.total - next.reduce((sum, item) => sum + item.amountMinor, 0n)).toString());
  }
  useOverlayKeys({ escape: () => { if (!terminal && !busy) onClose(); }, enter: terminal ? undefined : accept });
  const label = busy ? 'СОЗДАНИЕ ПРОДАЖИ…' : remaining === 0n && parts.length ? 'ПОВТОРИТЬ ОТПРАВКУ' : method?.kind === 'CARD' ? method.name.toUpperCase() : method?.kind === 'DEBT' ? 'ПРИНЯТЬ' : `ПРИНЯТЬ ${formatMinor(value)}СМН.`;

  return <div className="cs-pay" role="dialog" aria-modal="true" aria-label="Оплата">
    <button type="button" className="cs-text-button cs-pay-close" onClick={onClose} disabled={busy}>ЗАКРЫТЬ <Kbd>ESC</Kbd></button>
    <div className="cs-pay-columns">
      <section className="cs-pay-left">
        <h2>Платежи</h2>
        <div className="cs-pay-table">
          <button type="button" className="cs-pay-row" onClick={() => setShowTotals(current => !current)}><Icon name={showTotals ? 'chevronDown' : 'chevronRight'} size={20} /><span>Итог</span><span>{formatMinor(totals.total)}смн.</span></button>
          {showTotals && <><div className="cs-pay-row is-sub"><i /><span>Подытог</span><span>{formatMinor(totals.subtotal)}смн.</span></div><div className="cs-pay-row is-sub"><i /><span>Скидка</span><span>{formatMinor(totals.discount)}смн.</span></div></>}
          {methods.map(item => { const part = parts.find(entry => entry.methodId === item.id); return <div className="cs-pay-row" key={item.id}>
            {part ? <button type="button" className="cs-remove" aria-label={`Удалить платёж ${item.name}`} onClick={() => remove(part)} disabled={busy}><Icon name="minus" size={14} /></button> : <i />}
            <span>{item.name}</span><span>{formatMinor(part?.amountMinor ?? 0n)}смн.</span>
          </div>; })}
          <div className="cs-pay-row is-total"><Icon name="chevronUp" size={20} /><span>Принято</span><strong>{formatMinor(accepted)}смн.</strong></div>
        </div>
        <textarea className="cs-comment" placeholder="Комментарий к продаже" value={comment} maxLength={500} onChange={event => setComment(event.target.value)} disabled={busy} />
        <label className="cs-switch"><span className="cs-switch-label">Печатать чек</span><input type="checkbox" checked={print} onChange={event => setPrint(event.target.checked)} /><span className="cs-switch-track" /></label>
      </section>
      <section className="cs-pay-right">
        <h2>Принять оплату</h2>
        <div className="cs-pay-customer">{customer ? <><span className="cs-avatar is-cyan">{initials(customer)}</span><span><strong>{customer.firstName} {customer.lastName ?? ''}</strong>{debtBefore > 0n && <small className="cs-orange">Долг {formatMinor(debtBefore)}смн.</small>}</span></> : <><span className="cs-avatar is-cyan"><Icon name="person" size={20} /></span><span><strong>Розничный покупатель</strong></span></>}<button type="button" className="cs-small-button" onClick={onChangeCustomer} disabled={busy || accepted > 0n}>ИЗМЕНИТЬ</button></div>
        <div className="cs-methods" role="radiogroup" aria-label="Способ оплаты">{methods.map(item => <button type="button" role="radio" key={item.id} aria-checked={item.id === methodId} className={item.id === methodId ? 'is-on' : ''} onClick={() => { setMethodId(item.id); setError(''); setAmount(remaining.toString()); }} disabled={busy}><span className="cs-method-tile"><Icon name={methodIcon(item.kind)} size={30} /></span><small>{item.name}</small></button>)}</div>
        <label className="cs-outlined"><span>Сумма</span><MoneyInput autoFocus valueMinor={amount} onMinorChange={next => { setAmount(next); setError(''); }} disabled={busy} /></label>
        {method?.kind === 'CASH' && remaining > 0n && <><p className="cs-subtitle">Варианты оплаты наличными</p><div className="cs-bills">{cashOptions(remaining).map(option => <button type="button" key={option.toString()} className={option.toString() === amount ? 'is-on' : ''} onClick={() => setAmount(option.toString())} disabled={busy}>{whole(option)}</button>)}</div></>}
        {method?.kind === 'DEBT' && customer && <div className="cs-debt-box"><span>Общий долг составит:</span><strong>{formatMinor(debtAfter)}смн.</strong></div>}
        {method?.kind === 'BONUS' && customer && <p className="cs-caption">Доступно бонусов: {formatMinor(BigInt(customer.bonusBalanceMinor ?? '0') - bonusUsed)}</p>}
        {error && <p className="cs-error" role="alert">{error}</p>}
        <button type="button" className={`cs-pay-accept ${method?.kind === 'DEBT' ? 'is-accent' : ''}`} onClick={accept} disabled={busy}>{label}{method?.kind !== 'CARD' && method?.kind !== 'DEBT' && <Kbd>ENTER</Kbd>}</button>
      </section>
    </div>
    {terminal && <Modal title="Примите оплату через терминал" className="is-round" onClose={() => setTerminal(null)} action={{ label: 'УСПЕШНО', onClick: () => { add({ methodId: method!.id, kind: method!.kind, name: method!.name, amountMinor: terminal.amount, reference: cardReference(rrn, last4) }); setTerminal(null); setRrn(''); setLast4(''); } }}>
      <div className="cs-terminal"><strong>{formatMinor(terminal.amount)}смн.</strong><Icon name="terminal" size={96} /></div>
      <div className="cs-two"><label className="cs-outlined"><span>RRN</span><input inputMode="numeric" maxLength={12} value={rrn} onChange={event => setRrn(event.target.value.replace(/\D/g, ''))} placeholder="необязательно" /></label><label className="cs-outlined"><span>4 цифры карты</span><input inputMode="numeric" maxLength={4} value={last4} onChange={event => setLast4(event.target.value.replace(/\D/g, ''))} placeholder="необязательно" /></label></div>
    </Modal>}
  </div>;
}

export function SaleSuccess({ totals, methods, parts, change, onPrint, onClose }: { totals: Totals; methods: PosPaymentMethod[]; parts: PaymentPart[]; change: bigint; onPrint?: () => void; onClose: () => void }) {
  useOverlayKeys({ escape: onClose, enter: onClose });
  const [showTotals, setShowTotals] = useState(false);
  const accepted = parts.reduce((sum, part) => sum + part.amountMinor, 0n) + change;
  const shown = methods.filter(method => method.kind !== 'BONUS' || parts.some(part => part.methodId === method.id));
  return <div className="cs-pay cs-success" role="dialog" aria-modal="true" aria-label="Продажа прошла успешно">
    <section className="cs-success-card">
      <h2>Продажа прошла успешно</h2>
      <div className="cs-pay-table">
        <button type="button" className="cs-pay-row" onClick={() => setShowTotals(current => !current)}><Icon name={showTotals ? 'chevronDown' : 'chevronRight'} size={20} /><span>Итог</span><span>{formatMinor(totals.total)}смн.</span></button>
        {showTotals && <><div className="cs-pay-row is-sub"><i /><span>Подытог</span><span>{formatMinor(totals.subtotal)}смн.</span></div><div className="cs-pay-row is-sub"><i /><span>Скидка</span><span>{formatMinor(totals.discount)}смн.</span></div></>}
        {shown.map(method => { const part = parts.find(item => item.methodId === method.id); return <div className="cs-pay-row" key={method.id}><i /><span>{method.name}</span><span>{formatMinor((part?.amountMinor ?? 0n) + (method.kind === 'CASH' && part ? change : 0n))}смн.</span></div>; })}
        <div className="cs-pay-row is-total"><Icon name="chevronUp" size={20} /><span>Принято</span><strong>{formatMinor(accepted)}смн.</strong></div>
      </div>
      <div className="cs-change"><span>СДАЧА:</span><strong>{formatMinor(change)}смн.</strong></div>
      {onPrint && <button type="button" className="cs-text-button cs-success-print" onClick={onPrint}><Icon name="print" size={20} /> ПЕЧАТЬ ЧЕКА</button>}
      <button type="button" className="cs-outline-button" onClick={onClose} autoFocus>ЗАКРЫТЬ <Kbd>ENTER</Kbd></button>
    </section>
  </div>;
}
