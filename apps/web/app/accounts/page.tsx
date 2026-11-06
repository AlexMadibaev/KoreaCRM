'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { CreditCard, Landmark, Wallet } from 'lucide-react';
import { CatalogShell } from '../../components/catalog-shell';
import { amount, shiftMoment } from '../../components/shift-card';
import { api, queryString } from '../../lib/api';

type Account = { kind: 'CASH' | 'NONCASH'; name: string; deviceId: string | null; balanceMinor: string; inMinor: string | null; outMinor: string | null; lastAt: string | null };
type StoreAccounts = { id: string; name: string; accounts: Account[]; balanceMinor: string };

/** CloudShop "Компания → Счета": drawers of each register and non-cash receipts per store. */
function Accounts() {
  const [data, setData] = useState<{ stores: StoreAccounts[]; totalMinor: string } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { api<{ stores: StoreAccounts[]; totalMinor: string }>('/accounts').then(setData).catch(caught => setError(caught instanceof Error ? caught.message : 'Не удалось загрузить счета')); }, []);
  return <div className="crm-shifts">
    <div className="crm-registers-total">Баланс <strong>{data ? `${amount(data.totalMinor)} смн.` : '…'}</strong></div>
    <p className="crm-accounts-note">Касса — наличные в денежном ящике по последней смене. Безналичные счета — все поступления картой и переводом минус возвраты и выплаты этим способом.</p>
    {error && <p role="alert" className="crm-alert">{error}</p>}
    {!data && !error && <p role="status" className="crm-shifts-empty">Загружаем счета…</p>}
    {data?.stores.map(store => <section key={store.id} className="crm-account-store" aria-labelledby={`store-${store.id}`}>
      <header><h2 id={`store-${store.id}`}><Landmark size={16} aria-hidden /> Счёт магазина {store.name}</h2><strong>{amount(store.balanceMinor)} смн.</strong></header>
      {store.accounts.length ? <ul>{store.accounts.map(account => <li key={`${account.kind}:${account.name}`}>
        <span className="crm-account-name">{account.kind === 'CASH' ? <Wallet size={15} aria-hidden /> : <CreditCard size={15} aria-hidden />} {account.kind === 'CASH' ? <Link href={`/cash-shifts?${queryString({ storeId: store.id, deviceId: account.deviceId ?? undefined })}`}>{account.name}</Link> : <Link href={`/money?${queryString({ storeId: store.id })}`}>Расчётный счёт · {account.name}</Link>}</span>
        <span className="crm-account-meta">{account.kind === 'NONCASH' ? `поступило ${amount(account.inMinor)} · выплачено ${amount(account.outMinor)}` : account.lastAt ? `активность ${shiftMoment(account.lastAt)}` : ''}</span>
        <strong>{amount(account.balanceMinor)} смн.</strong>
      </li>)}</ul> : <p className="crm-account-empty">Пока нет касс и безналичных операций.</p>}
    </section>)}
  </div>;
}

export default function AccountsPage() {
  return <CatalogShell><Accounts /></CatalogShell>;
}
