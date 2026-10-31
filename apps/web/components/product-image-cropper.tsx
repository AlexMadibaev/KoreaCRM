'use client';

import { useEffect, useRef, useState } from 'react';

const outputSize = 360;

export function ProductImageCropper({ file, busy, onSave, onCancel }: {
  file: File;
  busy: boolean;
  onSave: (blob: Blob) => Promise<void>;
  onCancel: () => void;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const drag = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null);
  const [url, setUrl] = useState('');
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [error, setError] = useState('');

  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onCancel(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, onCancel]);

  const stageSize = stage.current?.clientWidth || 300;
  const cropSize = Math.min(dimensions.width, dimensions.height) / zoom;
  const displayWidth = cropSize ? stageSize * dimensions.width / cropSize : stageSize;
  const displayHeight = cropSize ? stageSize * dimensions.height / cropSize : stageSize;
  const maxX = Math.max(0, (displayWidth - stageSize) / 2);
  const maxY = Math.max(0, (displayHeight - stageSize) / 2);
  const clamp = (value: number, limit: number) => Math.max(-limit, Math.min(limit, value));
  const visibleOffset = { x: clamp(offset.x, maxX), y: clamp(offset.y, maxY) };

  async function save() {
    if (!image.current || !dimensions.width || !stageSize) return;
    setError('');
    const canvas = document.createElement('canvas');
    canvas.width = outputSize;
    canvas.height = outputSize;
    const context = canvas.getContext('2d');
    if (!context) { setError('Не удалось подготовить изображение.'); return; }
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    const sourceX = (dimensions.width - cropSize) / 2 - visibleOffset.x * cropSize / stageSize;
    const sourceY = (dimensions.height - cropSize) / 2 - visibleOffset.y * cropSize / stageSize;
    context.drawImage(image.current, sourceX, sourceY, cropSize, cropSize, 0, 0, outputSize, outputSize);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) { setError('Не удалось подготовить изображение.'); return; }
    try { await onSave(blob); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Не удалось загрузить фото.'); }
  }

  return <div className="crm-image-crop-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onCancel(); }}>
    <section className="crm-image-crop-dialog" role="dialog" aria-modal="true" aria-labelledby="crop-title">
      <div className="crm-image-crop-heading"><div><span className="crm-eyebrow">ФОТО ТОВАРА</span><h2 id="crop-title">Подгоните изображение</h2></div><button type="button" className="crm-image-crop-close" onClick={onCancel} disabled={busy} aria-label="Закрыть">×</button></div>
      <p>Перетащите фото внутри квадрата и настройте размер. Сохранится фрагмент 360 × 360 пикселей.</p>
      <div ref={stage} className="crm-image-crop-stage" onPointerDown={event => {
        if (busy || !dimensions.width) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { x: event.clientX, y: event.clientY, startX: visibleOffset.x, startY: visibleOffset.y };
      }} onPointerMove={event => {
        if (!drag.current) return;
        setOffset({ x: clamp(drag.current.startX + event.clientX - drag.current.x, maxX), y: clamp(drag.current.startY + event.clientY - drag.current.y, maxY) });
      }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
        {url && <img ref={image} src={url} alt="Фрагмент фотографии товара" draggable={false} onLoad={event => {
          setDimensions({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight });
          setZoom(1); setOffset({ x: 0, y: 0 });
        }} onError={() => setError('Не удалось открыть изображение.')} style={{ width: displayWidth, height: displayHeight, transform: `translate(calc(-50% + ${visibleOffset.x}px), calc(-50% + ${visibleOffset.y}px))` }} />}
      </div>
      <label className="crm-image-crop-zoom">Масштаб <input type="range" min="1" max="3" step="0.01" value={zoom} onChange={event => setZoom(Number(event.target.value))} disabled={busy || !dimensions.width} aria-label="Масштаб изображения" /><span>{Math.round(zoom * 100)}%</span></label>
      {error && <p role="alert" className="crm-alert">{error}</p>}
      <div className="crm-image-crop-actions"><button type="button" className="crm-outline-button" onClick={onCancel} disabled={busy}>Отмена</button><button type="button" className="crm-primary-button" onClick={() => void save()} disabled={busy || !dimensions.width}>{busy ? 'Сохраняем…' : 'Сохранить фото'}</button></div>
    </section>
  </div>;
}
