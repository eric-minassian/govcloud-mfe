export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="gm-spinner" role="status">
      <span className="gm-spinner__dot" aria-hidden="true" />
      <span>{label}…</span>
    </div>
  );
}
