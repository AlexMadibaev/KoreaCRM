'use client';

import { QRCodeSVG } from 'qrcode.react';

export type EmployeePosCodes = { employeeName: string; qrCode: string; ean13: string };

const leftOdd = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const leftEven = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const right = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
const parity = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

function Ean13({ value }: { value: string }) {
  const scheme = parity[Number(value[0])] ?? parity[0]!;
  const left = [...value.slice(1, 7)].map((digit, index) => scheme[index] === 'L' ? leftOdd[Number(digit)] : leftEven[Number(digit)]).join('');
  const bars = `101${left}01010${[...value.slice(7)].map(digit => right[Number(digit)]).join('')}101`;
  return <svg role="img" aria-label={`Штрихкод кассира ${value}`} viewBox="0 0 115 74" className="mx-auto w-full max-w-[390px]" shapeRendering="crispEdges">
    <rect width="115" height="74" fill="white" />
    {[...bars].map((bit, x) => bit === '1' ? <rect key={x} x={10 + x} y="3" width="1" height={x < 3 || x >= 92 || x >= 45 && x < 50 ? 58 : 51} fill="black" /> : null)}
    <text x="57.5" y="72" textAnchor="middle" fontFamily="monospace" fontSize="9" letterSpacing="2">{value}</text>
  </svg>;
}

export function EmployeePosCodesCard({ codes, onClose }: { codes: EmployeePosCodes; onClose: () => void }) {
  return <section id="employee-pos-codes" className="pos-code-print-card crm-panel p-5" aria-label="Коды входа в кассу">
    <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wider text-violet-600">Вход в кассу</p><h2 className="mt-1 text-lg font-bold">{codes.employeeName}</h2></div><button type="button" aria-label="Закрыть коды" onClick={onClose} className="print:hidden">✕</button></div>
    <p className="mt-3 text-xs leading-5 text-slate-600 print:hidden">Сохраните или распечатайте коды сейчас. После закрытия их нельзя посмотреть повторно; перевыпуск отключит прежние.</p>
    <div className="mt-5 flex justify-center rounded-xl border border-slate-200 bg-white p-4"><QRCodeSVG value={codes.qrCode} size={190} level="H" marginSize={2} role="img" aria-label={`QR-код для входа сотрудника ${codes.employeeName}`} /></div>
    <p className="mt-2 text-center text-xs font-semibold text-slate-600">QR-код сотрудника</p>
    <div className="mt-5 rounded-xl border border-slate-200 bg-white px-2 py-4"><Ean13 value={codes.ean13} /></div>
    <p className="mt-2 text-center text-xs font-semibold text-slate-600">Для сканера штрихкодов</p>
    <p className="mt-5 text-xs leading-5 text-slate-600">Коды дают доступ к кассе от имени сотрудника. Храните их как пароль. Для входа требуется связь с сервером.</p>
    <button type="button" onClick={() => window.print()} className="crm-primary-button mt-5 w-full print:hidden">Распечатать коды</button>
  </section>;
}
