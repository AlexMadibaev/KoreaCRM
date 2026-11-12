'use client';

import { useEffect, useState } from 'react';
import { formatCurrencyMinor } from '@koreacrm/ui';
import { api } from '../lib/api';

export function ProductPriceEditor({ productId }: { productId: string }) {
  const [price, setPrice] = useState<{ priceMinor: number | null; mixed: boolean } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setPrice(null);
    setError('');
    api<{ priceMinor: number | null; mixed: boolean }>(`/products/${productId}/price`)
      .then(value => { if (active) setPrice(value); })
      .catch(caught => { if (active) setError(caught instanceof Error ? caught.message : 'Не удалось загрузить цену'); });
    return () => { active = false; };
  }, [productId]);

  return <section className="crm-panel crm-product-price">
    <div className="crm-product-section-head"><span className="crm-eyebrow">ПРОДАЖИ</span><h2>Цена продажи</h2><p>Общая цена для всех магазинов.</p></div>
    {price && <div className="crm-product-current-price"><span>Текущая цена</span><strong>{price.mixed ? 'Разная по магазинам' : price.priceMinor === null ? 'Не установлена' : formatCurrencyMinor(String(price.priceMinor))}</strong></div>}
    {error && <p role="alert" className="crm-alert">{error}</p>}
  </section>;
}
