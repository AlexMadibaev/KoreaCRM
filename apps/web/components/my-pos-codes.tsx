'use client';
import { useState } from 'react';
import { api } from '../lib/api';
import { EmployeePosCodesCard, type EmployeePosCodes, type EmployeePosCodesResult } from './employee-pos-codes';

export function MyPosCodes() {
  const [codes, setCodes] = useState<EmployeePosCodes | null>(null);
  const [missing, setMissing] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function show() {
    setBusy(true); setError('');
    try { const result = await api<EmployeePosCodesResult>('/employees/me/pos-codes'); if (result.available) { setCodes(result); setMissing(null); } else setMissing(result.hasCodes); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось показать код.'); }
    finally { setBusy(false); }
  }
  async function issue() {
    setBusy(true); setError('');
    try { setCodes(await api<EmployeePosCodes>('/employees/me/pos-codes', { method: 'POST' })); setMissing(null); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось выдать код.'); }
    finally { setBusy(false); }
  }
  return <section className="crm-panel mt-6 p-5" aria-labelledby="my-pos-code-title"><h2 id="my-pos-code-title" className="text-lg font-semibold">Мой код входа в кассу</h2><p className="mt-2 text-sm text-slate-600">Покажите QR или штрихкод сканеру кассы либо скачайте личный бейдж.</p><button type="button" disabled={busy} onClick={() => void show()} className="ks-button ks-button--secondary mt-4">{busy ? 'Загрузка…' : 'Показать мой код'}</button>{missing !== null && <div className="mt-4"><p className="text-sm text-slate-600">{missing ? 'Старый код нельзя повторно открыть. Выпуск нового отключит прежний бейдж и входы в кассу по нему.' : 'У вас ещё нет кода входа.'}</p><button type="button" disabled={busy} onClick={() => void issue()} className="ks-button ks-button--primary mt-3">{missing ? 'Перевыпустить мой код' : 'Выдать мой код'}</button></div>}{error && <p role="alert" className="mt-3 text-sm text-rose-700">{error}</p>}{codes && <div className="mt-4"><EmployeePosCodesCard codes={codes} onClose={() => setCodes(null)} /></div>}</section>;
}
