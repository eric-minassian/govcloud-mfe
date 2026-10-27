import type { ReactNode } from 'react';

export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'success' | 'warning';
  children: ReactNode;
}) {
  return <span className={`gm-badge gm-badge--${tone}`}>{children}</span>;
}
