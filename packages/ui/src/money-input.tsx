import { forwardRef, useEffect, useRef, useState, type InputHTMLAttributes } from 'react';
import { formatMoneyInput, formatSignedMoneyInput, parseMoneyInput, parseSignedMoneyInput } from './money';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  valueMinor: string;
  onMinorChange: (minor: string) => void;
  allowNegative?: boolean;
};

export const MoneyInput = forwardRef<HTMLInputElement, Props>(function MoneyInput({ valueMinor, onMinorChange, allowNegative = false, onBlur, ...props }, ref) {
  const parse = allowNegative ? parseSignedMoneyInput : parseMoneyInput;
  const format = allowNegative ? formatSignedMoneyInput : formatMoneyInput;
  const [draft, setDraft] = useState(() => format(valueMinor));
  const lastSent = useRef(valueMinor);
  useEffect(() => {
    if (valueMinor !== lastSent.current) {
      lastSent.current = valueMinor;
      setDraft(format(valueMinor));
    }
  }, [valueMinor]);
  return <input {...props} ref={ref} type="text" inputMode="decimal" value={draft} aria-invalid={draft !== '' && parse(draft) === null} onChange={event => {
    const raw = event.target.value;
    setDraft(raw);
    const parsed = parse(raw) ?? '';
    lastSent.current = parsed;
    onMinorChange(parsed);
  }} onBlur={event => {
    const parsed = parse(draft);
    if (parsed !== null) setDraft(format(parsed));
    onBlur?.(event);
  }} />;
});
