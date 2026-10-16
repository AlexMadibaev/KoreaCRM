import { formatCurrencyMinor as money } from '@koreacrm/ui';

export type SalesTrendDay = { date: string; salesMinor: string; returnsMinor: string; netMinor: string; checksCount: number };
export type SalesTrendData = { from: string; to: string; storeId: string | null; days: SalesTrendDay[] };

const dayLabel = (date: string) => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00.000Z`));

export function SalesTrend({ data }: { data: SalesTrendData }) {
  const values = data.days.map(day => Number(day.netMinor));
  const highest = Math.max(0, ...values);
  const lowest = Math.min(0, ...values);
  const span = highest - lowest || 1;
  const zeroBottom = -lowest / span * 100;
  const hasActivity = data.days.some(day => day.netMinor !== '0');
  return <section className="crm-panel crm-trend" aria-label="Продажи по дням">
    <div className="crm-panel-heading"><div><span className="crm-eyebrow">ДИНАМИКА</span><h2>Продажи по дням</h2></div><span className="crm-trend-legend"><i /> Чистая выручка</span></div>
    {hasActivity ? <div className="crm-trend-chart" role="list" aria-label="Чистая выручка за каждый день">
      <div className="crm-trend-zero" style={{ bottom: `${zeroBottom}%` }} aria-hidden="true" />
      {data.days.map((day, index) => {
        const value = values[index] ?? 0;
        const height = Math.abs(value) / span * 100;
        const bottom = value >= 0 ? zeroBottom : zeroBottom - height;
        const showLabel = data.days.length <= 7 || index === 0 || index === data.days.length - 1 || index % 5 === 0;
        const description = `${dayLabel(day.date)}: чистая выручка ${money(day.netMinor)}, продажи ${money(day.salesMinor)}, возвраты ${money(day.returnsMinor)}, чеков ${day.checksCount}`;
        return <div className="crm-trend-day" key={day.date} role="listitem" aria-label={description} title={description}>
          {value !== 0 && <div className={`crm-trend-bar ${value < 0 ? 'negative' : ''}`} style={{ height: `${Math.max(2, height)}%`, bottom: `${bottom}%` }} aria-hidden="true" />}
          <span aria-hidden="true">{showLabel ? dayLabel(day.date) : ''}</span>
        </div>;
      })}
    </div> : <p className="crm-trend-empty">Чистая выручка за выбранный период равна нулю.</p>}
    <p className="crm-panel-note">Чистая выручка = продажи − возвраты. Оранжевый столбец означает, что возвраты за день превысили продажи.</p>
  </section>;
}
