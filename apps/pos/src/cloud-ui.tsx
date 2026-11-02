import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MoneyInput } from '@koreacrm/ui';
import { formatMinor } from './calculations';
import { ProductImage, type CatalogItem } from './product-results';

// Only the topmost overlay reacts to Escape and Enter, so nested windows close one at a time.
type KeyHandlers = { escape?: () => void; enter?: () => void };
const overlayStack: { current: KeyHandlers }[] = [];
let listening = false;
function onKey(event: KeyboardEvent) {
  const top = overlayStack.at(-1)?.current;
  if (!top) return;
  if (event.key === 'Escape' && top.escape) { event.preventDefault(); event.stopImmediatePropagation(); top.escape(); }
  if (event.key === 'Enter' && top.enter && !(event.target instanceof HTMLTextAreaElement) && !(event.target instanceof HTMLButtonElement)) { event.preventDefault(); event.stopImmediatePropagation(); top.enter(); }
}
export function hasOverlay() { return overlayStack.length > 0; }
export function useOverlayKeys(handlers: KeyHandlers) {
  const ref = useRef(handlers);
  ref.current = handlers;
  useEffect(() => {
    overlayStack.push(ref);
    if (!listening) { window.addEventListener('keydown', onKey, true); listening = true; }
    return () => { overlayStack.splice(overlayStack.indexOf(ref), 1); };
  }, []);
}

export const Kbd = ({ children }: { children: ReactNode }) => <kbd className="cs-kbd">{children}</kbd>;

export function Icon({ name, size = 24 }: { name: keyof typeof icons; size?: number }) {
  return <svg className="cs-icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><path d={icons[name]} /></svg>;
}
const icons = {
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  search: 'M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15zM21 21l-5.2-5.2',
  personAdd: 'M15 19v-1.5a4.5 4.5 0 0 0-9 0V19M10.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19 8v6M16 11h6',
  menu: 'M4 6h16M4 12h16M4 18h16',
  more: 'M12 5.5v.01M12 12v.01M12 18.5v.01',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5zM12 15v2',
  history: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2',
  close: 'M6 6l12 12M18 6L6 18',
  minus: 'M5 12h14',
  plus: 'M12 5v14M5 12h14',
  card: 'M3 6h18v12H3zM3 10h18M7 15h3',
  cash: 'M3 7h18v10H3zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 10v.01M18 14v.01',
  clock: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
  terminal: 'M7 3h10v18H7zM9 6h6v4H9zM9 13h.01M12 13h.01M15 13h.01M9 16h.01M12 16h.01M15 16h.01',
  wifi: 'M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5v.01',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9v.01',
  person: 'M18 20v-1.5a5.5 5.5 0 0 0-11 0V20M12.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
  print: 'M7 8V3h10v5M6 17H4v-7h16v7h-2M7 14h10v7H7z',
  undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7 7 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z',
  sync: 'M20 11a8 8 0 0 0-14.7-4.4L4 8M4 4v4h4M4 13a8 8 0 0 0 14.7 4.4L20 16M20 20v-4h-4',
  logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11',
  debt: 'M4 6h16v12H4zM8 10h8M8 14h5',
  receipt: 'M7 3h10v18l-2.5-1.5L12 21l-2.5-1.5L7 21zM10 8h4M10 12h4',
  chevronRight: 'M9 6l6 6-6 6',
  chevronDown: 'M6 9l6 6 6-6',
  chevronUp: 'M6 15l6-6 6 6',
  back: 'M19 12H5M11 6l-6 6 6 6',
  handshake: 'M3 11l4-4 4 2 3-2 3 2 4 4-6 6-3-3-2 2-3-3zM8 13l3 3M11 10l4 4',
  gift: 'M4 10h16v10H4zM3 7h18v3H3zM12 7v13M12 7c-2-4-6-3-5 0M12 7c2-4 6-3 5 0',
  phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z',
  at: 'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM16 12v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-3.5 7.1',
  idCard: 'M3 5h18v14H3zM7 15h4M7 11h10',
  calendar: 'M4 6h16v15H4zM4 10h16M8 3v4M16 3v4',
  folder: 'M3 6h6l2 2h10v11H3z',
  tiles: 'M4 4h7v7H4zM15 3l5 5-5 5-5-5zM4 15h7v6H4zM14 15h6v6h-6z',
  layout: 'M3 4h7v16H3zM12 4h9v7h-9zM12 13h9v7h-9z',
  userCircle: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6.5 18a6 6 0 0 1 11 0',
} as const;

export function Modal({ title, onClose, children, action, width = 444, className = '' }: { title: ReactNode; onClose: () => void; children: ReactNode; action?: { label: ReactNode; onClick: () => void; disabled?: boolean; tone?: 'accent' | 'primary' | 'danger' }; width?: number; className?: string }) {
  useOverlayKeys({ escape: onClose, enter: action && !action.disabled ? action.onClick : undefined });
  return <div className="cs-overlay" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className={`cs-modal ${className}`} style={{ width }} role="dialog" aria-modal="true">
      <header className="cs-modal-head"><h2>{title}</h2><button type="button" className="cs-text-button" onClick={onClose}>ЗАКРЫТЬ <Kbd>ESC</Kbd></button></header>
      <div className="cs-modal-body">{children}</div>
      {action && <footer className="cs-modal-foot"><button type="button" className={`cs-action is-${action.tone ?? 'accent'}`} disabled={action.disabled} onClick={action.onClick}><span>{action.label}</span><Kbd>ENTER</Kbd></button></footer>}
    </section>
  </div>;
}

export function Sheet({ title, onClose, children }: { title: ReactNode; onClose: () => void; children: ReactNode }) {
  useOverlayKeys({ escape: onClose });
  return <div className="cs-sheet" role="dialog" aria-modal="true">
    <header className="cs-sheet-head"><button type="button" aria-label="Назад" onClick={onClose}><Icon name="back" /></button><h2>{title}</h2></header>
    {/* Older screens are styled under .pos; the wrapper keeps those rules without the old page layout. */}
    <div className="cs-sheet-body"><div className="pos cs-legacy">{children}</div></div>
  </div>;
}

export function Stepper({ value, onChange, min = 1, max, big = false }: { value: number; onChange: (value: number) => void; min?: number; max?: number; big?: boolean }) {
  return <span className={big ? 'cs-stepper is-big' : 'cs-stepper'}>
    <button type="button" aria-label="Меньше" disabled={value <= min} onClick={event => { event.stopPropagation(); onChange(value - 1); }}><Icon name="minus" size={big ? 28 : 18} /></button>
    <strong>{value}</strong>
    <button type="button" aria-label="Больше" disabled={max !== undefined && value >= max} onClick={event => { event.stopPropagation(); onChange(value + 1); }}><Icon name="plus" size={big ? 28 : 18} /></button>
  </span>;
}

export type CardView = { mode: 'grid' | 'list'; size: number; showStock: boolean; showImage: boolean; showSku: boolean; hideEmpty: boolean };
export const defaultCardView: CardView = { mode: 'grid', size: 161, showStock: true, showImage: true, showSku: false, hideEmpty: false };

export function ProductGrid({ products, apiUrl, quantities, view, locked, onAdd, onStep }: { products: CatalogItem[]; apiUrl: string; quantities: Record<string, number>; view: CardView; locked: boolean; onAdd: (product: CatalogItem) => void; onStep: (product: CatalogItem, quantity: number) => void }) {
  const shown = view.hideEmpty ? products.filter(product => product.availableQuantity > 0) : products;
  return <ul className={`cs-grid is-${view.mode}`} style={{ ['--card-w' as string]: `${view.size}px` }}>{shown.map(product => {
    const key = 'images' in product ? product.images[0]?.storageKey : product.imageKey;
    const sellable = product.active && product.priceMinor !== null && product.availableQuantity > 0;
    const inCart = quantities[product.id] ?? 0;
    return <li key={product.id} className={`cs-card${inCart ? ' in-cart' : ''}${sellable ? '' : ' is-off'}`}>
      <button type="button" className="cs-card-hit" disabled={locked || !sellable} onClick={() => onAdd(product)} aria-label={`Добавить ${product.name}`}>
        {view.showStock && <span className="cs-card-stock">{product.availableQuantity} шт</span>}
        {view.showImage && <span className="cs-card-photo">{key ? <ProductImage key={`${apiUrl}:${key}`} storageKey={key} apiUrl={apiUrl} /> : <Icon name="tiles" size={64} />}</span>}
        <span className="cs-card-name" title={product.name}>{product.name}</span>
        {view.showSku && <span className="cs-card-sku">{product.sku}</span>}
      </button>
      <div className="cs-card-foot">{inCart > 0 && !locked ? <Stepper value={inCart} min={0} max={product.availableQuantity} onChange={value => onStep(product, value)} /> : <strong>{product.priceMinor === null ? 'Нет цены' : `${formatMinor(product.priceMinor)} смн.`}</strong>}</div>
    </li>;
  })}</ul>;
}

/** Discount editor shared by the line editor and the whole-receipt discount popover. */
export function DiscountFields({ baseMinor, discountMinor, onChange }: { baseMinor: bigint; discountMinor: bigint; onChange: (minor: bigint) => void }) {
  const percent = baseMinor > 0n ? Number(discountMinor * 10000n / baseMinor) / 100 : 0;
  const [percentText, setPercentText] = useState(String(percent));
  useEffect(() => { setPercentText(current => Number(current.replace(',', '.')) === percent ? current : String(percent)); }, [percent]);
  return <div className="cs-discount-fields">
    <label className="cs-outlined"><input inputMode="decimal" aria-label="Скидка в процентах" value={percentText} onChange={event => { setPercentText(event.target.value); const value = Number(event.target.value.replace(',', '.')); if (Number.isFinite(value) && value >= 0 && value <= 100) onChange(baseMinor * BigInt(Math.round(value * 100)) / 10000n); }} /><em>%</em></label>
    <label className="cs-outlined"><MoneyInput aria-label="Скидка в сомони" valueMinor={discountMinor.toString()} onMinorChange={minor => { const value = BigInt(minor || '0'); onChange(value > baseMinor ? baseMinor : value); }} /><em>смн.</em></label>
  </div>;
}

export function LineEditor({ name, imageKey, apiUrl, priceMinor, quantity, available, discountMinor, onApply, onClose }: { name: string; imageKey?: string; apiUrl: string; priceMinor: number; quantity: number; available: number; discountMinor: string; onApply: (quantity: number, discountMinor: string) => void; onClose: () => void }) {
  const [count, setCount] = useState(quantity);
  const gross = BigInt(priceMinor) * BigInt(count);
  const [discount, setDiscount] = useState(() => BigInt(discountMinor) > gross ? gross : BigInt(discountMinor));
  const capped = discount > gross ? gross : discount;
  return <Modal title={<span className="cs-line-title"><span className="cs-line-avatar">{imageKey ? <ProductImage storageKey={imageKey} apiUrl={apiUrl} /> : <Icon name="tiles" size={34} />}</span>{name}</span>} className="cs-line-modal" onClose={onClose} action={{ label: 'ПРИМЕНИТЬ', onClick: () => onApply(count, capped.toString()) }}>
    <label className="cs-outlined is-static"><span>Цена</span><input readOnly value={formatMinor(priceMinor)} /><em>смн.</em></label>
    <div className="cs-group"><p className="cs-group-label">Скидка</p><DiscountFields baseMinor={gross} discountMinor={capped} onChange={setDiscount} /></div>
    <div className="cs-group is-center"><p className="cs-group-label">Количество</p><Stepper big value={count} max={available} onChange={setCount} /></div>
    <div className="cs-line-total"><span>Итог</span><strong>{formatMinor(gross - capped)}смн.</strong></div>
  </Modal>;
}
