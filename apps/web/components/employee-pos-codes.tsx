'use client';

import { QRCodeSVG } from 'qrcode.react';
import { useRef, useState } from 'react';
import { downloadBadgePdf } from '../lib/badge-pdf';

export type EmployeePosCodes = { employeeName: string; qrCode: string; ean13: string };
export type EmployeePosCodesResult = ({ available: true } & EmployeePosCodes) | { available: false; hasCodes: boolean };

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
  const qr = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState('');
  async function download() {
    setDownloading(true); setDownloadError('');
    try {
      const element = qr.current?.querySelector('svg')?.cloneNode(true) as SVGSVGElement | undefined;
      if (!element) throw new Error('QR-код ещё не готов.');
      element.setAttribute('x', '110'); element.setAttribute('y', '263'); element.setAttribute('width', '320'); element.setAttribute('height', '320'); element.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      const scheme = parity[Number(codes.ean13[0])]!;
      const left = [...codes.ean13.slice(1, 7)].map((digit, index) => scheme[index] === 'L' ? leftOdd[Number(digit)] : leftEven[Number(digit)]).join('');
      const bars = `101${left}01010${[...codes.ean13.slice(7)].map(digit => right[Number(digit)]).join('')}101`;
      const module = 460 / 113;
      const rectangles = [...bars].map((bit, index) => bit === '1' ? `<rect x="${40 + (11 + index) * module}" y="658" width="${module}" height="${index < 3 || index >= 92 || index >= 45 && index < 50 ? 127 : 115}"/>` : '').join('');
      const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!);
      const nameLines: string[] = [];
      for (const word of codes.employeeName.trim().split(/\s+/).flatMap(word => word.match(/.{1,28}/gu) ?? [])) {
        const previous = nameLines.at(-1);
        if (previous && previous.length + word.length < 28) nameLines[nameLines.length - 1] = `${previous} ${word}`;
        else nameLines.push(word);
      }
      const nameStep = Math.min(36, 84 / Math.max(1, nameLines.length - 1));
      const nameSize = Math.min(32, nameStep - 3);
      const name = nameLines.map((line, index) => `<tspan x="32" y="${110 + index * nameStep}">${escape(line)}</tspan>`).join('');
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="54mm" height="86mm" viewBox="0 0 540 860"><rect width="540" height="860" fill="white"/><path d="M0 0H540V12H0Z" fill="#9c2548"/><g font-family="Arial,sans-serif" fill="#202630"><text x="32" y="58" font-size="27" font-weight="700">Korea CRM</text><text font-size="${nameSize}" font-weight="700">${name}</text><text x="32" y="226" font-size="21" fill="#606b79">Личная карта сотрудника</text></g><path d="M32 246H508" stroke="#dde2e8"/>${new XMLSerializer().serializeToString(element)}<text x="270" y="610" font-family="Arial,sans-serif" font-size="20" text-anchor="middle" fill="#606b79">QR-код для входа в кассу</text><g fill="black">${rectangles}</g><text x="270" y="825" font-family="monospace" font-size="26" text-anchor="middle" letter-spacing="3">${codes.ean13}</text></svg>`;
      await downloadBadgePdf(svg, codes.employeeName);
    } catch (reason) { setDownloadError(reason instanceof Error ? reason.message : 'Не удалось скачать бейдж.'); }
    finally { setDownloading(false); }
  }
  return <section id="employee-pos-codes" className="pos-code-print-card crm-panel p-5" aria-label="Коды входа в кассу">
    <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wider text-violet-600">Вход в кассу</p><h2 className="mt-1 text-lg font-bold">{codes.employeeName}</h2></div><button type="button" aria-label="Закрыть коды" onClick={onClose} className="ks-button ks-button--secondary print:hidden">✕</button></div>
    <p className="mt-3 text-xs leading-5 text-slate-600 print:hidden">Код можно повторно показать в личном кабинете. Перевыпуск отключит прежний бейдж.</p>
    <div ref={qr} className="mt-5 flex justify-center rounded-xl border border-slate-200 bg-white p-4"><QRCodeSVG value={codes.qrCode} size={190} level="M" marginSize={4} role="img" aria-label={`QR-код для входа сотрудника ${codes.employeeName}`} /></div>
    <p className="mt-2 text-center text-xs font-semibold text-slate-600">QR-код сотрудника</p>
    <div className="mt-5 rounded-xl border border-slate-200 bg-white px-2 py-4"><Ean13 value={codes.ean13} /></div>
    <p className="mt-2 text-center text-xs font-semibold text-slate-600">Для сканера штрихкодов</p>
    <p className="mt-5 text-xs leading-5 text-slate-600">Коды дают доступ к кассе от имени сотрудника. Храните их как пароль. Для входа требуется связь с сервером.</p>
    <button type="button" disabled={downloading} onClick={() => void download()} className="ks-button ks-button--primary crm-primary-button mt-5 w-full print:hidden">{downloading ? 'Готовим PDF…' : 'Скачать PDF-бейдж 54 × 86 мм'}</button>
    {downloadError && <p role="alert" className="mt-2 text-sm text-rose-700">{downloadError}</p>}
    <p className="mt-2 text-xs text-slate-500 print:hidden">Печатайте в масштабе 100%, без подгонки страницы.</p>
  </section>;
}
