import Link from 'next/link';
import { formatCurrencyMinor as money } from '@koreacrm/ui';

export type TopCustomersData = {
  from: string; to: string; storeId: string | null;
  items: { customerId: string; name: string; checksCount: number; revenueMinor: string }[];
};

export function TopCustomers({ data, error }: { data: TopCustomersData | null; error: string }) {
  return <section id="top-customers" className="crm-panel crm-top-customers" aria-labelledby="top-customers-title">
    <div className="crm-panel-heading"><div><span className="crm-eyebrow">ПОКУПАТЕЛИ</span><h2 id="top-customers-title">Топ клиентов</h2></div><Link href="/customers">Все клиенты →</Link></div>
    <p className="crm-panel-note">5 клиентов по сумме покупок после возвратов. Выбранные период и магазин учитываются.</p>
    {error ? <p className="crm-alert" role="alert">{error}</p> : !data ? <p className="crm-panel-note" role="status">Загружаем топ клиентов…</p> : data.items.length ? <ol className="crm-top-customers-list">{data.items.map((customer, index) => <li key={customer.customerId}>
      <span className="crm-top-customer-rank" aria-hidden="true">{index + 1}</span>
      <div className="crm-top-customer-name"><strong>{customer.name}</strong><small>Чеков: {new Intl.NumberFormat('ru-RU').format(customer.checksCount)}</small></div>
      <strong className="crm-top-customer-amount">{money(customer.revenueMinor)}</strong>
    </li>)}</ol> : <p className="crm-panel-note">За выбранный период покупок с указанным клиентом нет.</p>}
  </section>;
}
