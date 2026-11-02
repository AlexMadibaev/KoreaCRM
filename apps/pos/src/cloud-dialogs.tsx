import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { createApiClient } from '@koreacrm/api-client';
import { MoneyInput } from '@koreacrm/ui';
import type { PosCustomer, PosLastClosedShift, PosShift } from '@koreacrm/types';
import { formatMinor } from './calculations';
import { Icon, Kbd, Modal, useOverlayKeys, type CardView } from './cloud-ui';
import type { ParkedReceipt } from './parked-receipts';
import { varianceLabel } from './shift-report';

type Client = ReturnType<typeof createApiClient>;
const fullName = (customer: PosCustomer) => `${customer.firstName} ${customer.lastName ?? ''}`.trim();
const whole = (minor: bigint) => minor % 100n === 0n ? new Intl.NumberFormat('ru-RU').format(minor / 100n) : formatMinor(minor);
const initials = (name: string) => name.split(/\s+/).map(part => part[0] ?? '').join('').slice(0, 2).toUpperCase();

export function OpenShiftModal({ client, storeId, deviceId, storeName, errorText, onOpened, onClose }: { client: Client; storeId: string; deviceId: string; storeName: string; errorText: (caught: unknown) => string; onOpened: (shift: PosShift) => void; onClose: () => void }) {
  const [previous, setPrevious] = useState<PosLastClosedShift | undefined>(undefined);
  const [counted, setCounted] = useState('0'), [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    client.get<PosLastClosedShift>(`/stores/${storeId}/finance/cash-shifts/last-closed?deviceId=${encodeURIComponent(deviceId)}`)
      .then(value => { setPrevious(value); setCounted(value?.closingCashMinor ?? '0'); }).catch(() => setPrevious(null));
  }, [client, storeId, deviceId]);
  const expected = BigInt(previous?.closingCashMinor ?? counted);
  const variance = /^\d+$/.test(counted) ? BigInt(counted) - expected : 0n;
  async function open() {
    if (variance !== 0n && !comment.trim()) { setError('Укажите причину расхождения.'); return; }
    setBusy(true); setError('');
    try { onOpened(await client.post<PosShift>(`/stores/${storeId}/finance/cash-shifts`, { deviceId, openingCashMinor: counted, ...(comment.trim() ? { comment: comment.trim() } : {}) })); }
    catch (caught) { setError(errorText(caught)); }
    finally { setBusy(false); }
  }
  return <Modal title="Открытие смены" onClose={onClose} action={{ label: 'ОТКРЫТЬ СМЕНУ', tone: 'primary', onClick: () => void open(), disabled: busy || previous === undefined }}>
    <p className="cs-caption">Сверка денег в кассе</p>
    <div className="cs-field"><span>Касса</span><strong>{storeName}</strong></div>
    <label className="cs-input"><span>Сумма денег в кассе</span><MoneyInput autoFocus valueMinor={counted} onMinorChange={setCounted} /></label>
    {variance !== 0n && <div className="cs-note"><p>Расчётная сумма в кассе: <strong>{formatMinor(expected)} смн.</strong></p><p>Расхождение по кассе: <strong>{varianceLabel(variance)}</strong></p><p>Расхождение будет записано в смену с вашим комментарием.</p></div>}
    {variance !== 0n && <label className={`cs-input${!comment.trim() ? ' is-required' : ''}`}><span>Комментарий *</span><textarea value={comment} onChange={event => setComment(event.target.value)} maxLength={1000} /></label>}
    {error && <p className="cs-error" role="alert">{error}</p>}
  </Modal>;
}

export function CustomerPickerModal({ customers, search, onSearch, onPick, onClose }: { customers: PosCustomer[]; search: string; onSearch: (value: string) => void; onPick: (customer: PosCustomer | null) => void; onClose: () => void }) {
  const matches = customers.filter(customer => !search.trim() || `${fullName(customer)} ${customer.phone}`.toLocaleLowerCase('ru').includes(search.trim().toLocaleLowerCase('ru'))).slice(0, 30);
  useOverlayKeys({ escape: onClose, enter: matches[0] && search.trim() ? () => onPick(matches[0]!) : undefined });
  return <div className="cs-overlay is-top" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="cs-dropdown" role="dialog" aria-modal="true" aria-label="Поиск покупателя">
      <label className="cs-dropdown-search"><Icon name="search" size={28} /><input autoFocus value={search} onChange={event => onSearch(event.target.value)} placeholder="Поиск покупателя по имени, телефону" /><button type="button" className="cs-text-button" onClick={onClose}>ЗАКРЫТЬ <Kbd>ESC</Kbd></button></label>
      <ul>
        {matches.map(customer => <li key={customer.id}><button type="button" onClick={() => onPick(customer)}><strong>{fullName(customer)}</strong>{customer.debtBalanceMinor && customer.debtBalanceMinor !== '0' ? <span className="cs-orange"> • Долг {formatMinor(customer.debtBalanceMinor)}смн.</span> : <small> • {customer.phone}</small>}</button></li>)}
        <li><button type="button" onClick={() => onPick(null)}><strong>Розничный покупатель</strong></button></li>
      </ul>
    </section>
  </div>;
}

export type NewCustomer = { firstName: string; lastName: string | null; phone: string; email: string | null; birthday: string | null; notes: string | null; discountPercent?: string };
export function CustomerCreateModal({ initial, canDiscount, loyaltyMode, onCreate, onClose }: { initial: string; canDiscount: boolean; loyaltyMode: 'DISCOUNT' | 'BONUS'; onCreate: (customer: NewCustomer) => Promise<string | null>; onClose: () => void }) {
  const looksLikePhone = /^\+?\d[\d\s()-]*$/.test(initial.trim());
  const [name, setName] = useState(looksLikePhone ? '' : initial.trim());
  const [phones, setPhones] = useState<string[]>([looksLikePhone ? initial.trim() : '']);
  const [email, setEmail] = useState(''), [birthday, setBirthday] = useState(''), [discount, setDiscount] = useState(''), [card, setCard] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function create() {
    const [first = '', ...rest] = name.trim().split(/\s+/);
    const phone = phones[0]!.replace(/[\s()-]/g, '');
    if (!first) { setError('Укажите имя покупателя.'); return; }
    if (!/^\+[1-9]\d{7,14}$/.test(phone)) { setError('Телефон с кодом страны, например +992901234567.'); return; }
    const birth = birthday.trim() ? /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(birthday.trim()) : null;
    if (birthday.trim() && !birth) { setError('Дата рождения в формате ДД.ММ.ГГГГ.'); return; }
    const extraPhones = phones.slice(1).map(value => value.trim()).filter(Boolean).join(', ');
    const notes = [extraPhones ? `Доп. телефоны: ${extraPhones}` : '', card.trim() ? `Дисконтная карта: ${card.trim()}` : ''].filter(Boolean).join('\n');
    setBusy(true); setError('');
    const problem = await onCreate({ firstName: first, lastName: rest.join(' ') || null, phone, email: email.trim() || null, birthday: birth ? `${birth[3]}-${birth[2]}-${birth[1]}` : null, notes: notes || null, ...(canDiscount && discount.trim() && discount.trim() !== '0' ? { discountPercent: discount.trim().replace(',', '.') } : {}) });
    setBusy(false);
    if (problem) setError(problem);
  }
  return <Modal title="Создание клиента" onClose={onClose} width={500} action={{ label: busy ? 'СОЗДАНИЕ…' : 'СОЗДАТЬ', tone: 'accent', onClick: () => void create(), disabled: busy }}>
    <label className="cs-outlined"><span>Имя покупателя *</span><input autoFocus value={name} onChange={event => setName(event.target.value)} maxLength={200} /><Icon name="userCircle" size={22} /></label>
    <div className="cs-row-head"><span>Телефон</span><button type="button" className="cs-text-button is-blue" onClick={() => setPhones(current => [...current, ''])}>+ ДОБАВИТЬ НОМЕР ТЕЛЕФОНА</button></div>
    {phones.map((phone, index) => <label className="cs-outlined" key={index}><span>Телефон{index ? ` ${index + 1}` : ''}</span><input type="tel" value={phone} onChange={event => setPhones(current => current.map((value, position) => position === index ? event.target.value : value))} placeholder="+992901234567" /><Icon name="phone" size={22} /></label>)}
    <label className="cs-outlined"><span>Email</span><input type="email" value={email} onChange={event => setEmail(event.target.value)} /><Icon name="at" size={22} /></label>
    <div className="cs-radio-tiles"><span className={loyaltyMode === 'DISCOUNT' ? 'is-on' : ''}><i />Скидка</span><span className={loyaltyMode === 'BONUS' ? 'is-on' : ''}><i />Бонусы</span></div>
    {loyaltyMode === 'DISCOUNT' && <div className="cs-panel"><p className="cs-group-label">Скидка</p>{canDiscount ? <label className="cs-outlined"><span>Персональная скидка</span><input inputMode="decimal" value={discount} onChange={event => setDiscount(event.target.value)} placeholder="0" /><em>%</em></label> : <p className="cs-warning">Персональную скидку может установить администратор.</p>}<p className="cs-caption">Накопительные скидки магазина учитываются автоматически.</p></div>}
    <label className="cs-outlined"><span>Дисконтная карта</span><input value={card} onChange={event => setCard(event.target.value)} /><Icon name="idCard" size={22} /></label>
    <label className="cs-outlined"><span>Дата рождения</span><input value={birthday} onChange={event => setBirthday(event.target.value)} placeholder="ДД.ММ.ГГГГ" /><Icon name="calendar" size={22} /></label>
    {error && <p className="cs-error" role="alert">{error}</p>}
  </Modal>;
}

export function QueueModal<Line extends { quantity: number; priceMinor: number; discountMinor: string; product: { name: string } }>({ receipts, onPick, onDelete, onClose }: { receipts: ParkedReceipt<Line, PosCustomer>[]; onPick: (receipt: ParkedReceipt<Line, PosCustomer>) => void; onDelete: (receipt: ParkedReceipt<Line, PosCustomer>) => void; onClose: () => void }) {
  return <Modal title="Очередь чеков" onClose={onClose} width={500} className="cs-queue-modal">
    {!receipts.length && <p className="cs-caption">Отложенных чеков нет.</p>}
    <ul className="cs-queue">{receipts.map(receipt => <li key={receipt.id}>
      <header><strong>Продажа</strong><span><Icon name="person" size={16} />{receipt.customer ? fullName(receipt.customer) : 'Розничный покупатель'}</span><time><Icon name="clock" size={16} />{new Date(receipt.createdAt).toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</time></header>
      {receipt.lines.map((line, index) => <div className="cs-queue-line" key={index}><span><i><Icon name="tiles" size={12} /></i>{line.product.name}</span><span>{line.quantity}</span><span>{whole(BigInt(line.priceMinor) * BigInt(line.quantity) - BigInt(line.discountMinor))}</span></div>)}
      <footer><button type="button" className="cs-action is-primary is-small" onClick={() => onPick(receipt)}><Icon name="logout" size={18} /> ВЫБРАТЬ</button><button type="button" className="cs-text-button is-danger" onClick={() => onDelete(receipt)}>УДАЛИТЬ</button></footer>
    </li>)}</ul>
  </Modal>;
}

export function SellerModal({ sellers, sellerId, onPick, onClose }: { sellers: { id: string; name: string }[]; sellerId: string; onPick: (id: string) => void; onClose: () => void }) {
  const [search, setSearch] = useState('');
  const shown = sellers.filter(seller => seller.name.toLocaleLowerCase('ru').includes(search.trim().toLocaleLowerCase('ru')));
  return <Modal title="Продавец" onClose={onClose}>
    <label className="cs-input"><span>Поиск</span><input autoFocus value={search} onChange={event => setSearch(event.target.value)} /></label>
    <ul className="cs-list">
      <li><button type="button" className={!sellerId ? 'is-on' : ''} onClick={() => onPick('')}><span className="cs-avatar"><Icon name="person" /></span><span><strong>Без продавца</strong><small>продажа на кассира</small></span></button></li>
      {shown.map(seller => <li key={seller.id}><button type="button" className={seller.id === sellerId ? 'is-on' : ''} onClick={() => onPick(seller.id)}><span className="cs-avatar">{initials(seller.name)}</span><span><strong>{seller.name}</strong></span></button></li>)}
    </ul>
  </Modal>;
}

export function ReceiptDiscountModal({ baseMinor, currentMinor, onApply, onClose }: { baseMinor: bigint; currentMinor: bigint; onApply: (minor: bigint) => void; onClose: () => void }) {
  const [unit, setUnit] = useState<'percent' | 'sum'>('percent');
  const [text, setText] = useState(() => baseMinor > 0n && currentMinor > 0n ? String(Number(currentMinor * 10000n / baseMinor) / 100) : '0');
  const [sum, setSum] = useState(currentMinor.toString());
  const percentValue = Number(text.replace(',', '.'));
  const value = unit === 'percent' ? (Number.isFinite(percentValue) && percentValue >= 0 && percentValue <= 100 ? baseMinor * BigInt(Math.round(percentValue * 100)) / 10000n : 0n) : (/^\d+$/.test(sum) ? BigInt(sum) : 0n);
  const capped = value > baseMinor ? baseMinor : value;
  useOverlayKeys({ escape: onClose, enter: () => onApply(capped) });
  return <div className="cs-pop-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="cs-discount-pop" role="dialog" aria-label="Размер скидки">
      <header><strong>Размер скидки</strong><span>{formatMinor(capped)}смн.</span></header>
      <div className="cs-segment">{(['percent', 'sum'] as const).map(option => <button type="button" key={option} className={unit === option ? 'is-on' : ''} onClick={() => setUnit(option)}>{option === 'percent' ? '%' : 'СМН.'}</button>)}</div>
      {unit === 'percent' ? <label className="cs-outlined"><input autoFocus inputMode="decimal" value={text} onChange={event => setText(event.target.value)} /><em>%</em></label> : <label className="cs-outlined"><MoneyInput autoFocus valueMinor={sum} onMinorChange={setSum} /><em>смн.</em></label>}
      <button type="button" className="cs-action is-primary is-small" onClick={() => onApply(capped)}>ГОТОВО</button>
    </div>
  </div>;
}

export function CatalogModePopover({ mode, onPick, onClose }: { mode: 'products' | 'categories'; onPick: (mode: 'products' | 'categories') => void; onClose: () => void }) {
  useOverlayKeys({ escape: onClose });
  const tiles = [{ key: 'products', label: 'Товары', icon: 'tiles' }, { key: 'categories', label: 'Категории', icon: 'layout' }] as const;
  return <div className="cs-pop-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="cs-mode-pop">{tiles.map(tile => <button type="button" key={tile.key} className={mode === tile.key ? 'is-on' : ''} onClick={() => { onPick(tile.key); onClose(); }}><Icon name={tile.icon} size={34} />{tile.label}</button>)}</div>
  </div>;
}

type MenuItem = { label: string; icon: Parameters<typeof Icon>[0]['name']; onClick: () => void; danger?: boolean; hidden?: boolean };
export function PopoverMenu({ items, header, anchor, onClose }: { items: (MenuItem | 'divider')[]; header?: ReactNode; anchor: 'left' | 'right'; onClose: () => void }) {
  useOverlayKeys({ escape: onClose });
  return <div className="cs-pop-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className={`cs-pop is-${anchor}`} role="menu">
      {header}
      {items.filter(item => item === 'divider' || !item.hidden).map((item, index) => item === 'divider' ? <hr key={index} /> : <button type="button" role="menuitem" key={item.label} className={item.danger ? 'is-danger' : ''} onClick={() => { onClose(); item.onClick(); }}><Icon name={item.icon} size={20} />{item.label}</button>)}
      {anchor === 'right' && <><hr /><button type="button" className="cs-pop-cancel" onClick={onClose}><span className="cs-pop-gap" />Отмена<Kbd>Esc</Kbd></button></>}
    </div>
  </div>;
}

export type PosSettingsState = CardView & { printByDefault: boolean; printerHost: string; sound: boolean };
function RadioGroup<T extends string>({ title, value, options, onChange }: { title: string; value: T; options: [T, string][]; onChange: (value: T) => void }) {
  return <section className="cs-set-group"><h3>{title}</h3><div className="cs-set-box">{options.map(([key, label]) => <button type="button" key={key} role="radio" aria-checked={value === key} className={value === key ? 'is-on' : ''} onClick={() => onChange(key)}><i />{label}</button>)}</div></section>;
}

/** Till settings with the same sections as the cloud POS: general, equipment and product display. */
export function SettingsPanel({ value, onChange, version }: { value: PosSettingsState; onChange: (value: PosSettingsState) => void; version: string }) {
  const [tab, setTab] = useState<'main' | 'equipment' | 'products'>('main');
  const set = <K extends keyof PosSettingsState>(key: K, next: PosSettingsState[K]) => onChange({ ...value, [key]: next });
  const sample = useMemo(() => ({ name: 'Пример товара', price: '150,00' }), []);
  const tabs = [['main', 'Основные', 'menu'], ['equipment', 'Оборудование', 'print'], ['products', 'Отображение товаров', 'tiles']] as const;
  return <div className="cs-settings">
    <nav className="cs-set-tabs">{tabs.map(([key, label, icon]) => <button type="button" key={key} className={tab === key ? 'is-on' : ''} onClick={() => setTab(key)}><Icon name={icon} size={22} />{label}</button>)}</nav>
    <div className="cs-set-page">
      {tab === 'main' && <>
        <RadioGroup title="Оформление" value="brand" options={[['brand', 'Светлое, фирменные цвета']]} onChange={() => undefined} />
        <RadioGroup title="Печать чека" value={value.printByDefault ? 'yes' : 'no'} options={[['yes', 'Печатать чек по умолчанию'], ['no', 'Не печатать']]} onChange={next => set('printByDefault', next === 'yes')} />
        <RadioGroup title="Товары с нулевым остатком" value={value.hideEmpty ? 'hide' : 'show'} options={[['show', 'Показывать'], ['hide', 'Не показывать']]} onChange={next => set('hideEmpty', next === 'hide')} />
      </>}
      {tab === 'equipment' && <section className="cs-set-group"><h3>Принтер чеков</h3><div className="cs-set-box is-padded"><label className="cs-outlined"><span>IP-адрес принтера (ESC/POS, порт 9100)</span><input value={value.printerHost} onChange={event => set('printerHost', event.target.value)} placeholder="Например, 192.168.1.50" /></label><p className="cs-caption">Без адреса чек и отчёт смены печатаются через системный диалог печати Windows.</p></div></section>}
      {tab === 'products' && <>
        <RadioGroup title="Отображение товаров" value={value.mode} options={[['grid', 'Сетка'], ['list', 'Список']]} onChange={next => set('mode', next)} />
        <section className="cs-set-group"><h3>Карточка товара</h3><div className="cs-set-box">{([['showStock', 'остаток на складе'], ['showImage', 'изображение'], ['showSku', 'артикул']] as const).map(([key, label]) => <button type="button" key={key} role="checkbox" aria-checked={value[key]} className={`is-check${value[key] ? ' is-on' : ''}`} onClick={() => set(key, !value[key])}><Icon name="check" size={20} />{label}</button>)}</div></section>
        <section className="cs-set-group"><div className="cs-set-box is-padded"><label className="cs-range"><span>Размер карточки</span><input type="range" min={150} max={350} step={50} value={value.size} onChange={event => set('size', Number(event.target.value))} /><em>{value.size}</em></label><div className="cs-sample" style={{ width: value.size }}>{value.showStock && <span className="cs-card-stock">12 шт</span>}{value.showImage && <span className="cs-card-photo"><Icon name="tiles" size={48} /></span>}<span className="cs-card-name">{sample.name}</span><strong>{sample.price} смн.</strong></div></div></section>
      </>}
      <p className="cs-caption cs-version">Версия: {version}</p>
    </div>
  </div>;
}

export function ReturnReasonModal({ totalMinor, onConfirm, onClose, busy }: { totalMinor: bigint; onConfirm: (reason: string) => void; onClose: () => void; busy: boolean }) {
  const [reason, setReason] = useState('');
  return <Modal title="Возврат без чека" onClose={onClose} action={{ label: `ВЫДАТЬ ${formatMinor(totalMinor)} СМН.`, tone: 'accent', disabled: busy || reason.trim().length < 5, onClick: () => onConfirm(reason.trim()) }}>
    <p className="cs-caption">Деньги выдаются наличными из кассы. Операция попадёт в отчёт смены и журнал действий.</p>
    <label className="cs-input is-required"><span>Причина возврата *</span><textarea autoFocus value={reason} onChange={event => setReason(event.target.value)} maxLength={500} placeholder="Например, брак, покупатель потерял чек" /></label>
  </Modal>;
}

/** Keeps a ticking clock for the status bar. */
export function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 15_000); return () => window.clearInterval(timer); }, []);
  return now;
}
