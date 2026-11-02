'use client';

import { AppWindow, ChevronDown, Monitor, Smartphone } from 'lucide-react';
import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { deviceKind, shortDeviceCode } from '../lib/device-kind';

export type StoreDevice = { deviceId: string; status: string; lastActivityAt: string | null };
export type DeviceUnbindError = { deviceId: string; message: string; openShift: boolean };

function DeviceRow({ device, busy, canUnbind, onUnbind, error, shiftsHref }: { device: StoreDevice; busy: boolean; canUnbind: boolean; onUnbind: (deviceId: string) => void; error?: DeviceUnbindError; shiftsHref?: string }) {
  const alertRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (error) { alertRef.current?.focus(); alertRef.current?.scrollIntoView({ block: 'nearest' }); } }, [error]);
  const kind = deviceKind(device.deviceId);
  const title = kind === 'pos' ? 'Касса Windows POS' : kind === 'web' ? 'Личный кабинет в браузере' : 'Другое устройство';
  const Icon = kind === 'pos' ? Monitor : kind === 'web' ? AppWindow : Smartphone;
  return <article className="crm-device-row">
    <span className={`crm-device-icon ${kind}`}><Icon size={22} aria-hidden /></span>
    <div className="crm-device-info"><strong>{title}</strong><span>Код: {shortDeviceCode(device.deviceId)}</span><p>{device.lastActivityAt ? `Последняя активность: ${new Date(device.lastActivityAt).toLocaleString('ru-RU')}` : 'Активность ещё не зафиксирована'}</p><details><summary>Технический номер для поддержки</summary><code>{device.deviceId}</code></details>{error && <div ref={alertRef} role="alert" tabIndex={-1} className="crm-device-warning"><strong>{error.openShift ? 'Нельзя отвязать: открыта кассовая смена' : 'Не удалось отвязать устройство'}</strong><p>{error.message}</p>{error.openShift && (shiftsHref ? <Link href={shiftsHref}>Перейти к кассовым сменам</Link> : <p>Попросите управляющего закрыть смену.</p>)}</div>}</div>
    <div className="crm-device-actions"><span className={`crm-device-status ${device.status === 'DISABLED' ? 'disabled' : ''}`}>{device.status === 'DISABLED' ? 'Доступ отключён' : 'Доступ разрешён'}</span>{canUnbind && <button type="button" disabled={busy} onClick={() => onUnbind(device.deviceId)}>{kind === 'pos' ? 'Отвязать кассу' : kind === 'web' ? 'Отвязать браузер' : 'Отвязать устройство'}</button>}</div>
  </article>;
}

export function StoreDevices({ devices, busy, canUnbind, onUnbind, unbindError, storeId, canViewShifts }: { devices: StoreDevice[]; busy: boolean; canUnbind: boolean; onUnbind: (deviceId: string) => void; unbindError?: DeviceUnbindError | null; storeId: string; canViewShifts: boolean }) {
  const pos = devices.filter(device => deviceKind(device.deviceId) === 'pos');
  const web = devices.filter(device => deviceKind(device.deviceId) === 'web');
  const other = devices.filter(device => deviceKind(device.deviceId) === 'other');
  const rows = (items: StoreDevice[]) => items.map(device => <DeviceRow key={device.deviceId} device={device} busy={busy} canUnbind={canUnbind} onUnbind={onUnbind} error={unbindError?.deviceId === device.deviceId ? unbindError : undefined} shiftsHref={canViewShifts ? `/finance?storeId=${encodeURIComponent(storeId)}#cash-shifts` : undefined} />);
  return <section className="crm-panel p-6" aria-label="Кассы и подключения личного кабинета">
    <h3 className="font-semibold">Кассы и личный кабинет</h3>
    <div className="crm-device-group"><h4><Monitor size={18} aria-hidden />Кассы POS <span>{pos.length}</span></h4><p>Установленная программа для продаж на Windows. Здесь показаны кассы, привязанные к этому магазину.</p>{pos.length ? rows(pos) : <p className="crm-device-empty">Кассы POS пока не подключены. Установите программу и войдите в магазин.</p>}</div>
    <details className="crm-browser-devices"><summary><AppWindow size={18} aria-hidden /><strong>Личный кабинет в браузере</strong><span>{web.length}</span><ChevronDown className="crm-device-chevron" size={16} aria-hidden /></summary><p>Это подключения ЛК, а не установленные кассы POS. В разных браузерах или после очистки данных могут появляться отдельные записи. Отвязка убирает связь с магазином, но не завершает вход пользователя.</p>{web.length ? rows(web) : <p className="crm-device-empty">Подключений браузера пока нет.</p>}</details>
    {other.length > 0 && <details className="crm-browser-devices"><summary><Smartphone size={18} aria-hidden /><strong>Другие устройства</strong><span>{other.length}</span><ChevronDown className="crm-device-chevron" size={16} aria-hidden /></summary><p>Тип этих подключений не определён. Номер устройства доступен в технических сведениях.</p>{rows(other)}</details>}
    <p className="crm-device-footnote">«Доступ разрешён» означает разрешение подключаться к магазину. Это не показатель связи с устройством прямо сейчас.</p>
  </section>;
}
