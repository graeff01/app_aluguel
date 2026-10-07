export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite" className="animate-pulse">
      <p className="sr-only">Carregando…</p>
      <div className="mb-3 h-3 w-32 rounded-full bg-black/[0.06]" />
      <div className="mb-7 h-8 w-56 rounded-full bg-black/[0.06]" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="mb-3 h-32 rounded-3xl border border-line bg-surface" />
      ))}
    </div>
  );
}
