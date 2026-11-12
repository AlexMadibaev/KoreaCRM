'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import type { Sale } from './sales-ledger';

type Seller = { id: string; name: string };

export function SaleDetailsForm({ sale, storeId, onSaved }: { sale: Sale; storeId: string; onSaved: (sale: Sale) => void }) {
  const [open, setOpen] = useState(false);
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [sellerId, setSellerId] = useState(sale.seller?.id ?? '');
  const [comment, setComment] = useState(sale.comment ?? '');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!open) return;
    let active = true;
    api<Seller[]>(`/stores/${storeId}/sales/edit/sellers`)
      .then(items => { if (active) setSellers(items); })
      .catch(() => { if (active) setError('Не удалось загрузить продавцов'); });
    return () => { active = false; };
  }, [open, storeId]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const updated = await api<Sale>(`/stores/${storeId}/sales/${sale.id}/details`, {
        method: 'PATCH',
        body: JSON.stringify({ sellerId: sellerId || null, comment, reason }),
      });
      onSaved(updated);
      setReason('');
      setSaved(true);
      setOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось сохранить чек');
    } finally {
      setSaving(false);
    }
  }

  return <section className="mt-4 space-y-2">
    <p className="text-sm">Продавец: {sale.seller?.name ?? 'Не указан'}</p>
    {sale.comment && <p className="text-sm">{sale.comment}</p>}
    <button type="button" className="ks-button ks-button--secondary ks-button--sm" aria-expanded={open} disabled={saving} onClick={() => { setSaved(false); setOpen(!open); }}>
      {open ? 'Свернуть' : 'Изменить продавца и комментарий'}
    </button>
    {saved && <p role="status" className="text-sm">Изменения сохранены.</p>}
    {open && <form className="grid gap-3" onSubmit={save}>
      <label>Продавец<select className="block w-full rounded border p-2" value={sellerId} onChange={event => setSellerId(event.target.value)} disabled={saving}>
        <option value="">Не указан</option>
        {sale.seller && !sellers.some(seller => seller.id === sale.seller?.id) && <option value={sale.seller.id}>{sale.seller.name}</option>}
        {sellers.map(seller => <option value={seller.id} key={seller.id}>{seller.name}</option>)}
      </select></label>
      <label>Комментарий<textarea className="block w-full rounded border p-2" value={comment} maxLength={500} onChange={event => setComment(event.target.value)} disabled={saving} /></label>
      <label>Причина изменения<input className="block w-full rounded border p-2" value={reason} minLength={5} maxLength={500} required onChange={event => setReason(event.target.value)} disabled={saving} /></label>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <button type="submit" className="ks-button ks-button--primary ks-button--sm" disabled={saving}>{saving ? 'Сохраняем…' : 'Сохранить изменения'}</button>
    </form>}
  </section>;
}
