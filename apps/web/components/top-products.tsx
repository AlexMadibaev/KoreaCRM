import { formatCurrencyMinor as money } from '@koreacrm/ui';

export type TopProduct = { productId: string; name: string; sku: string; quantity: number; revenueMinor: string };
export type TopProductsData = { from: string; to: string; storeId: string | null; items: TopProduct[] };

export function TopProducts({ data }: { data: TopProductsData }) {
  const maximum = Math.max(1, ...data.items.map(item => item.quantity));
  return <section className="crm-panel crm-top-products" aria-label="Самые продаваемые товары">
    <div className="crm-panel-heading"><div><span className="crm-eyebrow">АССОРТИМЕНТ</span><h2>Топ товаров</h2></div><span className="crm-top-products-note">По количеству после возвратов</span></div>
    {data.items.length ? <ol className="crm-top-products-list">{data.items.map(item => <li key={item.productId}>
      <div className="crm-top-products-row"><span><strong>{item.name}</strong><small>{item.sku}</small></span><span className="crm-top-products-values"><strong>{new Intl.NumberFormat('ru-RU').format(item.quantity)} шт.</strong><small>{money(item.revenueMinor)}</small></span></div>
      <div className="crm-top-products-track" aria-hidden="true"><span style={{ width: `${item.quantity / maximum * 100}%` }} /></div>
    </li>)}</ol> : <p className="crm-top-products-empty">За выбранный период проданных товаров нет.</p>}
  </section>;
}
