'use client';

import { useEffect, useRef, useState, type ReactNode, type TouchEvent } from 'react';
import { ChevronLeft, ChevronRight, Expand, X } from 'lucide-react';

export type GalleryImage = { id: string; src: string; alt: string; pending?: boolean };

export function ProductGallery({ images, empty, onRemove, disabled = false }: {
  images: GalleryImage[];
  empty: ReactNode;
  onRemove?: (id: string) => void;
  disabled?: boolean;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const thumbs = useRef<HTMLDivElement>(null);
  const touchX = useRef<number | null>(null);
  const selectedIndex = Math.max(0, images.findIndex(image => image.id === selectedId));
  const selected = images[selectedIndex];

  function select(index: number) {
    if (!images.length) return;
    const next = images[(index + images.length) % images.length];
    if (!next) return;
    setSelectedId(next.id);
    const item = thumbs.current?.querySelector<HTMLElement>(`[data-gallery-id="${next.id}"]`);
    if (item && thumbs.current) thumbs.current.scrollTo({ left: item.offsetLeft - (thumbs.current.clientWidth - item.clientWidth) / 2, behavior: 'smooth' });
  }

  function swipeEnd(event: TouchEvent) {
    if (touchX.current === null || images.length < 2) return;
    const point = event.changedTouches[0];
    if (!point) return;
    const distance = point.clientX - touchX.current;
    touchX.current = null;
    if (Math.abs(distance) >= 45) select(selectedIndex + (distance < 0 ? 1 : -1));
  }

  useEffect(() => {
    if (!open) return;
    const modal = dialog.current;
    if (!modal) return;
    modal.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      if (modal.open) modal.close();
      document.body.style.overflow = previousOverflow;
      opener.current?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight') { event.preventDefault(); select(selectedIndex + 1); }
      if (event.key === 'ArrowLeft') { event.preventDefault(); select(selectedIndex - 1); }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [open, selectedIndex, images]);

  useEffect(() => { if (open && !images.length) setOpen(false); }, [open, images.length]);

  return <div className="crm-gallery">
    {selected ? <div className="crm-gallery-stage" onTouchStart={event => { touchX.current = event.changedTouches[0]?.clientX ?? null; }} onTouchEnd={swipeEnd}>
      <button ref={opener} type="button" className="crm-gallery-open" onClick={() => setOpen(true)} aria-label={`Открыть фото ${selectedIndex + 1} из ${images.length} в полном размере`}>
        <img src={selected.src} alt={selected.alt} />
        <span className="crm-gallery-expand" aria-hidden="true"><Expand size={18} strokeWidth={1.8} /></span>
      </button>
      {images.length > 1 && <>
        <button type="button" className="crm-gallery-arrow crm-gallery-arrow-prev" onClick={() => select(selectedIndex - 1)} aria-label="Предыдущее фото"><ChevronLeft size={21} strokeWidth={2} /></button>
        <button type="button" className="crm-gallery-arrow crm-gallery-arrow-next" onClick={() => select(selectedIndex + 1)} aria-label="Следующее фото"><ChevronRight size={21} strokeWidth={2} /></button>
      </>}
      <span className="crm-gallery-counter" aria-live="polite">{selectedIndex + 1} / {images.length}</span>
    </div> : <div className="crm-product-image-preview">{empty}</div>}

    {images.length > 1 || (onRemove && images.length > 0) ? <div ref={thumbs} className="crm-gallery-thumbs" aria-label="Фотографии товара">{images.map((image, index) => <div key={image.id} data-gallery-id={image.id} className={`crm-gallery-thumb ${image.id === selected?.id ? 'active' : ''}`}>
      <button type="button" className="crm-gallery-thumb-select" aria-label={`Показать фото ${index + 1} из ${images.length}`} aria-pressed={image.id === selected?.id} onClick={() => select(index)}><img src={image.src} alt="" /></button>
      {image.pending && <span className="crm-gallery-new">Новое</span>}
      {onRemove && <button type="button" className="crm-gallery-thumb-remove" disabled={disabled} onClick={() => onRemove(image.id)} aria-label={`Убрать фото ${index + 1} из черновика`}><X size={14} strokeWidth={2} /></button>}
    </div>)}</div> : null}

    {open && selected && <dialog ref={dialog} className="crm-gallery-dialog" onClose={() => setOpen(false)} aria-label="Просмотр фотографий товара">
      <div className="crm-gallery-dialog-top"><span>Фото {selectedIndex + 1} из {images.length}</span><button type="button" onClick={() => setOpen(false)} aria-label="Закрыть просмотр"><X size={22} strokeWidth={1.8} /></button></div>
      <div className="crm-gallery-dialog-body" onTouchStart={event => { touchX.current = event.changedTouches[0]?.clientX ?? null; }} onTouchEnd={swipeEnd}>
        {images.length > 1 && <button type="button" className="crm-gallery-dialog-nav" onClick={() => select(selectedIndex - 1)} aria-label="Предыдущее фото"><ChevronLeft size={26} strokeWidth={1.8} /></button>}
        <img src={selected.src} alt={selected.alt} />
        {images.length > 1 && <button type="button" className="crm-gallery-dialog-nav" onClick={() => select(selectedIndex + 1)} aria-label="Следующее фото"><ChevronRight size={26} strokeWidth={1.8} /></button>}
      </div>
      {images.length > 1 && <p className="crm-gallery-dialog-hint">Листайте фото стрелками или свайпом</p>}
    </dialog>}
  </div>;
}
