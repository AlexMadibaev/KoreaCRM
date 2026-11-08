'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Lock, LockOpen, Plus } from 'lucide-react';
import { CatalogShell } from '../../components/catalog-shell';
import { amount, shiftMoment } from '../../components/shift-card';
import { api, queryString } from '../../lib/api';
import { shortDeviceCode } from '../../lib/device-kind';

type Register = { deviceId: string; storeId: string; store: string; status: string; appVersion: string | null; lastActivityAt: string | null; createdAt: string; balanceMinor: string; hasOpenShift: boolean; cashiers: string; shifts: number };

function Registers() {
  const [data, setData] = useState<{ items: Register[]; totalBalanceMinor: string } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { api<{ items: Register[]; totalBalanceMinor: string }>('/registers').then(setData).catch(caught => setError(caught instanceof Error ? caught.message : 'Не удалось загрузить кассы')); }, []);
  return <div className="crm-shifts">
    <div className="crm-shifts-toolbar">
      <div className="crm-registers-total">Всего денег в кассах <strong>{data ? `${amount(data.totalBalanceMinor)} смн.` : '…'}</strong></div>
      <Link href="/stores" className="ks-button ks-button--primary crm-primary-button"><Plus size={14} aria-hidden /> Подключить кассу</Link>
    </div>
    {error && <p role="alert" className="crm-alert">{error}</p>}
    <div className="crm-shifts-table-wrap" aria-busy={!data && !error}>
      <table className="crm-shifts-table">
        <thead><tr><th scope="col">Наименование</th><th scope="col">Магазин</th><th scope="col" className="num">Баланс, смн.</th><th scope="col">Кассиры</th><th scope="col">Смена</th><th scope="col" className="num">Смен</th><th scope="col">Последняя активность</th><th scope="col">Создан</th></tr></thead>
        <tbody>{data?.items.map(register => <tr key={`${register.storeId}:${register.deviceId}`}>
          <td><Link className="crm-link-button" href={`/cash-shifts?${queryString({ storeId: register.storeId, deviceId: register.deviceId })}`}>Касса {shortDeviceCode(register.deviceId)}</Link>{register.status !== 'ACTIVE' && <small className="crm-muted"> · отключена</small>}</td>
          <td>{register.store}</td>
          <td className="num">{amount(register.balanceMinor)}</td>
          <td>{register.cashiers || '—'}</td>
          <td>{register.hasOpenShift ? <span className="crm-register-open"><LockOpen size={14} aria-hidden /> открыта</span> : <span className="crm-muted"><Lock size={14} aria-hidden /> закрыта</span>}</td>
          <td className="num">{register.shifts}</td>
          <td>{register.lastActivityAt ? shiftMoment(register.lastActivityAt) : '—'}</td>
          <td>{shiftMoment(register.createdAt)}</td>
        </tr>)}</tbody>
      </table>
      {data && !data.items.length && <div className="crm-shifts-empty"><strong>Касс пока нет</strong><p>Установите кассу на компьютер магазина и подключите её в разделе «Магазины».</p></div>}
      {!data && !error && <p role="status" className="crm-shifts-empty">Загружаем кассы…</p>}
    </div>
  </div>;
}

export default function RegistersPage() {
  return <CatalogShell><Registers /></CatalogShell>;
}
