import type { ButtonHTMLAttributes } from 'react';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'default' | 'sm';
};

export function Button({ variant = 'secondary', size = 'default', className, type = 'button', ...props }: ButtonProps) {
  return <button {...props} type={type} className={['ks-button', `ks-button--${variant}`, size === 'sm' && 'ks-button--sm', className].filter(Boolean).join(' ')} />;
}
