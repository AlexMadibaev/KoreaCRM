'use client';

import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { SearchCaption } from './search-caption';

/** CloudShop-style filter chip: a lowercase caption over a borderless control, with an optional clear button. */
export function FilterChip({ label, onClear, children, wide }: { label: string; onClear?: () => void; children: ReactNode; wide?: boolean }) {
  return <div className={`crm-chip${wide ? ' is-wide' : ''}`}><span className="crm-chip-label">{label.trim().toLocaleLowerCase('ru') === 'поиск' ? <SearchCaption text={label} /> : label}</span><div className="crm-chip-value">{children}{onClear && <button className="ks-button ks-button--ghost ks-button--sm ks-button--icon" type="button" aria-label={`Сбросить: ${label}`} onClick={onClear}><X size={12} aria-hidden /></button>}</div></div>;
}

/** Calendar day in Dushanbe (UTC+5), the day boundaries the API uses. */
export const dushanbeDay = (offsetDays = 0) => new Date(Date.now() + 5 * 3_600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);
