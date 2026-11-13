import { useEffect, useRef, type ChangeEvent, type InputHTMLAttributes } from 'react';

type Props = InputHTMLAttributes<HTMLInputElement> & { fractionDigits?: number };

export function TypedInput({ type, inputMode, onChange, value, min, max, pattern, maxLength, fractionDigits = 2, ...props }: Props) {
  const ref = useRef<HTMLInputElement>(null);
  const phone = type === 'tel' || inputMode === 'tel';
  const decimal = inputMode === 'decimal';
  const integer = type === 'number' || inputMode === 'numeric';
  const negative = min !== undefined && Number(min) < 0;
  const sign = negative ? '-?' : '';
  const draft = new RegExp(decimal ? `^${sign}\\d*(?:[.,]\\d{0,${fractionDigits}})?$` : `^${sign}\\d*$`);
  const finalPattern = decimal ? `${sign}[0-9]+(?:[.,][0-9]{1,${fractionDigits}})?` : integer ? `${sign}[0-9]+` : undefined;

  useEffect(() => {
    const input = ref.current;
    if (!input) return;
    const amount = Number(input.value.replace(',', '.'));
    const outside = input.value !== '' && (min !== undefined && amount < Number(min) || max !== undefined && amount > Number(max));
    input.setCustomValidity(outside ? 'Значение вне допустимого диапазона.' : '');
  }, [value, min, max]);

  function change(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const raw = input.value;
    const next = phone ? raw.replace(/[\s().-]/g, '') : type === 'number' && decimal ? raw.replace(',', '.') : raw;
    if (phone ? !/^\+?\d*$/.test(next) || next.replace(/^\+/, '').length > 15 : !draft.test(next)) {
      input.value = String(value ?? '');
      return;
    }
    if (next !== raw) input.value = next;
    onChange?.(event);
  }

  return <input {...props} ref={ref} type={phone ? 'tel' : type === 'password' ? 'password' : 'text'}
    inputMode={phone ? 'tel' : decimal ? 'decimal' : 'numeric'} value={value} onChange={change}
    maxLength={maxLength} pattern={pattern ?? (phone ? '[+]?[0-9]{1,15}' : finalPattern)} />;
}

export function todayDateInput() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}
