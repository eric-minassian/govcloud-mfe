import type { ReactNode } from 'react';

export function PageHeader({ title, description }: { title: string; description?: ReactNode }) {
  return (
    <header className="gm-page-header">
      <h1>{title}</h1>
      {description && <p>{description}</p>}
    </header>
  );
}
