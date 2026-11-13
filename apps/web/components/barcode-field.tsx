'use client';

import { useId, useState } from 'react';
import { TypedInput } from '@koreacrm/ui';

export function BarcodeField({ barcodes, draft: barcodeDraft, onDraftChange: setBarcodeDraft, onChange, disabled }: {
  barcodes: string[];
  draft: string;
  onDraftChange: (draft: string) => void;
  onChange: (barcodes: string[]) => void;
  disabled: boolean;
}) {
  const barcodeInputId = useId();
  const [barcodeError, setBarcodeError] = useState('');

  function addBarcodes(text: string) {
    const incoming = text.split(/\r\n|[\r\n]/).map(value => value.trim()).filter(Boolean);
    const next = [...new Set([...barcodes, ...incoming])];
    if (next.length > 30 || incoming.some(value => !/^\d{1,120}$/.test(value))) {
      setBarcodeError('Можно добавить до 30 штрихкодов. В каждом должно быть от 1 до 120 цифр.');
      return;
    }
    onChange(next);
    setBarcodeDraft('');
    setBarcodeError('');
  }

  return <div className="crm-product-form-wide min-w-0 space-y-2">
    <label htmlFor={barcodeInputId}>Штрихкоды</label>
    {barcodes.length > 0 && <ul className="flex flex-wrap gap-2">
      {barcodes.map(value => <li key={value} className="inline-flex max-w-full items-center gap-1 rounded-full border border-rose-200 bg-rose-50 py-1 pl-3 pr-1 text-sm text-slate-800">
        <span className="min-w-0 break-all">{value}</span>
        <button type="button" className="ks-button ks-button--ghost ks-button--sm shrink-0" aria-label={`Удалить штрихкод ${value}`} disabled={disabled} onClick={() => {
          onChange(barcodes.filter(barcode => barcode !== value));
          setBarcodeError('');
        }}>×</button>
      </li>)}
    </ul>}
    <div className="flex flex-wrap items-center gap-2">
      <TypedInput id={barcodeInputId} inputMode="numeric" maxLength={120} className="min-w-0 flex-1" value={barcodeDraft} placeholder="Введите или отсканируйте штрихкод"
        disabled={disabled} autoComplete="off" aria-describedby={`${barcodeInputId}-hint${barcodeError ? ` ${barcodeInputId}-error` : ''}`}
        onChange={event => { setBarcodeDraft(event.target.value); setBarcodeError(''); }}
        onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); addBarcodes(barcodeDraft); } }}
        onPaste={event => {
          const text = event.clipboardData.getData('text');
          if (!text.trim()) return;
          event.preventDefault();
          addBarcodes([barcodeDraft, text].filter(Boolean).join('\n'));
        }} />
      <button type="button" className="ks-button ks-button--secondary ks-button--sm" disabled={disabled || !barcodeDraft.trim()} onClick={() => addBarcodes(barcodeDraft)}>Добавить</button>
    </div>
    <p id={`${barcodeInputId}-hint`} className="text-xs text-slate-500">Нажмите Enter или вставьте несколько штрихкодов, по одному в строке.</p>
    {barcodeError && <p id={`${barcodeInputId}-error`} role="alert" className="text-sm text-red-700">{barcodeError}</p>}
  </div>;
}
