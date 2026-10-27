import type { ReactNode } from 'react';

export function Card({ title, children }: { title?: ReactNode; children: ReactNode }) {
  return (
    <section className="gm-card">
      {title && <h2 className="gm-card__title">{title}</h2>}
      {children}
    </section>
  );
}
