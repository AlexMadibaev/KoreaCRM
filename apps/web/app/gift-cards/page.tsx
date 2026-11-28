'use client';

import { MoneyInput } from '@koreacrm/ui';
import { QRCodeSVG } from 'qrcode.react';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Plus, Printer } from 'lucide-react';
import { CatalogShell } from '../../components/catalog-shell';
import { CabinetDrawer } from '../../components/cabinet-drawer';
import { amount } from '../../components/shift-card';
import { SearchCaption } from '../../components/search-caption';
import { api, type Page } from '../../lib/api';

type GiftCard = { id: string; code: string; initialMinor: string; balanceMinor: string; status: 'ACTIVE' | 'BLOCKED'; expiresAt: string | null; comment: string | null; createdAt: string };
type Transaction = { id: string; type: 'ISSUE' | 'REDEEM' | 'REFUND'; amountMinor: string; balanceAfterMinor: string; createdAt: string };
type GiftCardDetail = GiftCard & { transactions: Transaction[] };

const dateFormat = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Dushanbe' });
const dateTimeFormat = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dushanbe' });
const transactionTitle: Record<Transaction['type'], string> = { ISSUE: 'Выпуск', REDEEM: 'Оплата покупки', REFUND: 'Возврат на карту' };
const errorText = (caught: unknown) => caught instanceof Error && caught.message ? caught.message : 'Не удалось выполнить действие';
const expired = (card: GiftCard) => Boolean(card.expiresAt && new Date(card.expiresAt).getTime() < Date.now());
const statusTitle = (card: GiftCard) => card.status === 'BLOCKED' ? 'Заблокирована' : expired(card) ? 'Срок истёк' : card.balanceMinor === '0' ? 'Израсходована' : 'Активна';

/** Gift cards: issue a card with a QR code, print it, see its balance and history, block a lost one. */
export default function GiftCardsPage() {
  const [items, setItems] = useState<GiftCard[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [canManage, setCanManage] = useState(false);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<GiftCardDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [amountMinor, setAmountMinor] = useState(''), [expiresAt, setExpiresAt] = useState(''), [comment, setComment] = useState('');

  const load = useCallback(async (query: string) => {
    setLoading(true);
    try {
      const page = await api<Page<GiftCard>>(`/gift-cards?limit=100${query.trim() ? `&search=${encodeURIComponent(query.trim())}` : ''}`);
      setItems(page.items); setTotal(page.total); setError('');
    } catch (caught) { setError(errorText(caught)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { api<{ permissions: string[] }>('/auth/me').then(me => setCanManage(me.permissions.includes('giftcards.manage'))).catch(() => undefined); }, []);
  useEffect(() => { const timer = window.setTimeout(() => void load(search), 250); return () => window.clearTimeout(timer); }, [load, search]);

  async function open(id: string) {
    setError('');
    try { setSelected(await api<GiftCardDetail>(`/gift-cards/${id}`)); } catch (caught) { setError(errorText(caught)); }
  }
  async function issue(event: FormEvent) {
    event.preventDefault();
    if (!amountMinor || amountMinor === '0') { setError('Укажите сумму карты.'); return; }
    setBusy(true); setError('');
    try {
      const card = await api<GiftCard>('/gift-cards', { method: 'POST', body: JSON.stringify({ amountMinor, expiresAt: expiresAt || null, ...(comment.trim() ? { comment: comment.trim() } : {}) }) });
      setCreating(false); setAmountMinor(''); setExpiresAt(''); setComment('');
      await load(search); await open(card.id);
    } catch (caught) { setError(errorText(caught)); } finally { setBusy(false); }
  }
  // The card prints alone on its own page, so the cabinet around it does not end up on paper.
  function printCard(card: GiftCard) {
    const svg = document.querySelector('.crm-gift-card-print svg')?.outerHTML;
    const page = svg ? window.open('', '_blank', 'width=420,height=620') : null;
    if (!svg || !page) { setError('Браузер не открыл окно печати. Разрешите всплывающие окна для этого сайта.'); return; }
    const lines = [`Гифт-карта на ${amount(card.initialMinor)} смн.`, card.expiresAt ? `Действует до ${dateFormat.format(new Date(card.expiresAt))}` : ''].filter(Boolean);
    page.document.write(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Гифт-карта ${card.code}</title><style>body{margin:0;font-family:system-ui,sans-serif;color:#111;background:#fff}main{display:grid;justify-items:center;gap:8px;padding:32px 16px;text-align:center}strong{font:600 20px/1.2 ui-monospace,monospace;letter-spacing:1px}span{font-size:15px}</style></head><body><main>${svg}<strong>${card.code}</strong>${lines.map(line => `<span>${line}</span>`).join('')}</main></body></html>`);
    page.document.close(); page.focus(); page.print();
  }
  async function setStatus(card: GiftCard, status: GiftCard['status']) {
    if (status === 'BLOCKED' && !window.confirm(`Заблокировать гифт-карту ${card.code}? Ею нельзя будет оплатить, пока вы её не разблокируете.`)) return;
    setBusy(true); setError('');
    try { await api(`/gift-cards/${card.id}`, { method: 'PATCH', body: JSON.stringify({ status }) }); await load(search); await open(card.id); }
    catch (caught) { setError(errorText(caught)); } finally { setBusy(false); }
  }

  return <CatalogShell><div className="crm-screen crm-shifts">
    <div className="crm-shifts-toolbar">
      <div className="crm-chips"><div className="crm-chip is-wide"><span className="crm-chip-label"><SearchCaption text="поиск" /></span><div className="crm-chip-value"><input type="search" aria-label="Поиск гифт-карт" placeholder="номер карты или комментарий" value={search} onChange={event => setSearch(event.target.value)} /></div></div></div>
      <div className="crm-shifts-tools">
        <span className="crm-list-total">Итог {total}</span>
        {canManage && <button type="button" className="ks-button ks-button--primary crm-primary-button" onClick={() => { setCreating(true); setSelected(null); setError(''); }}><Plus size={14} aria-hidden /> Выпустить карту</button>}
      </div>
    </div>
    {error && !creating && !selected && <p role="alert" className="crm-alert">{error}</p>}
    <div className="crm-shifts-table-wrap" aria-busy={loading}>
      <table className="crm-shifts-table"><thead><tr><th scope="col">Номер карты</th><th scope="col" className="num">Номинал, смн.</th><th scope="col" className="num">Остаток, смн.</th><th scope="col">Статус</th><th scope="col">Действует до</th><th scope="col">Комментарий</th><th scope="col">Выпущена</th></tr></thead>
        <tbody>{items.map(card => <tr key={card.id}>
          <td><button type="button" className="ks-button ks-button--ghost ks-button--sm crm-link-button" onClick={() => void open(card.id)}>{card.code}</button></td>
          <td className="num">{amount(card.initialMinor)}</td><td className="num">{amount(card.balanceMinor)}</td>
          <td>{statusTitle(card)}</td><td>{card.expiresAt ? dateFormat.format(new Date(card.expiresAt)) : 'Бессрочно'}</td>
          <td className="crm-cell-clip">{card.comment ?? ''}</td><td>{dateFormat.format(new Date(card.createdAt))}</td>
        </tr>)}</tbody>
      </table>
      {loading && !items.length && <p role="status" className="crm-shifts-empty">Загрузка…</p>}
      {!loading && !items.length && <div className="crm-shifts-empty"><strong>{search.trim() ? 'Ничего не найдено' : 'Гифт-карт пока нет'}</strong><p>{search.trim() ? 'Измените поиск.' : canManage ? 'Выпустите первую карту: у неё будет QR-код, который сканируют на кассе при оплате.' : 'Карты выпускает владелец или директор.'}</p></div>}
    </div>

    {creating && <CabinetDrawer title="Новая гифт-карта" onClose={() => { setCreating(false); setError(''); }}>
      <form className="crm-shift-open crm-supplier-form" onSubmit={issue}>
        <label>Номинал, сомони<MoneyInput required autoFocus valueMinor={amountMinor} onMinorChange={setAmountMinor} placeholder="0,00" /></label>
        <label>Действует до<input type="date" value={expiresAt} onChange={event => setExpiresAt(event.target.value)} /><small>Оставьте пустым для бессрочной карты.</small></label>
        <label>Комментарий<input maxLength={500} value={comment} onChange={event => setComment(event.target.value)} placeholder="Например: подарок на 8 марта" /></label>
        {error && <p role="alert" className="crm-alert">{error}</p>}
        <button type="submit" disabled={busy} className="ks-button ks-button--primary crm-primary-button">{busy ? 'Выпускаем…' : 'Выпустить карту'}</button>
      </form>
    </CabinetDrawer>}

    {selected && <CabinetDrawer title={`Гифт-карта ${selected.code}`} onClose={() => { setSelected(null); setError(''); }}>
      <div className="crm-gift-card">
        <section className="crm-gift-card-print" aria-label="Карта для печати">
          <QRCodeSVG value={selected.code} size={200} level="M" marginSize={2} />
          <strong className="crm-gift-card-code">{selected.code}</strong>
          <span>Гифт-карта на {amount(selected.initialMinor)} смн.</span>
          {selected.expiresAt && <span>Действует до {dateFormat.format(new Date(selected.expiresAt))}</span>}
        </section>
        <dl className="crm-gift-card-facts">
          <div><dt>Остаток</dt><dd>{amount(selected.balanceMinor)} смн.</dd></div>
          <div><dt>Статус</dt><dd>{statusTitle(selected)}</dd></div>
          {selected.comment && <div><dt>Комментарий</dt><dd>{selected.comment}</dd></div>}
        </dl>
        <div className="crm-gift-card-actions">
          <button type="button" className="ks-button ks-button--secondary crm-outline-button" onClick={() => printCard(selected)}><Printer size={14} aria-hidden /> Печать карты</button>
          {canManage && (selected.status === 'ACTIVE'
            ? <button type="button" disabled={busy} className="ks-button ks-button--ghost ks-button--danger-text" onClick={() => void setStatus(selected, 'BLOCKED')}>Заблокировать</button>
            : <button type="button" disabled={busy} className="ks-button ks-button--secondary crm-outline-button" onClick={() => void setStatus(selected, 'ACTIVE')}>Разблокировать</button>)}
        </div>
        {error && <p role="alert" className="crm-alert">{error}</p>}
        <h3>История</h3>
        <ul className="crm-gift-card-history">{selected.transactions.map(item => <li key={item.id}>
          <span>{transactionTitle[item.type]}<small>{dateTimeFormat.format(new Date(item.createdAt))}</small></span>
          <span className="num">{item.amountMinor.startsWith('-') ? '−' + amount(item.amountMinor.slice(1)) : '+' + amount(item.amountMinor)}<small>остаток {amount(item.balanceAfterMinor)}</small></span>
        </li>)}</ul>
      </div>
    </CabinetDrawer>}
  </div></CatalogShell>;
}
