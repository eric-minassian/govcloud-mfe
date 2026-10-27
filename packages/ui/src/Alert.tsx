import type { ReactNode } from 'react';

interface AlertProps {
  tone?: 'info' | 'warning' | 'error';
  title: string;
  children?: ReactNode;
}

export function Alert({ tone = 'info', title, children }: AlertProps) {
  return (
    <div className={`gm-alert gm-alert--${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <strong>{title}</strong>
      {children && <div className="gm-alert__body">{children}</div>}
    </div>
  );
}
