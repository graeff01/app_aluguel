export default function Loading() {
  return (
    <div aria-busy="true" className="mx-auto max-w-xl">
      <p className="sr-only">Carregando suas visitas…</p>
      <div className="mb-2 h-3 w-36 animate-pulse rounded-full bg-tint" />
      <div className="mb-3 h-8 w-60 animate-pulse rounded-full bg-tint" />
      <div className="mb-7 h-16 animate-pulse rounded-[22px] border border-line bg-surface" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="mb-3 h-36 animate-pulse rounded-[26px] border border-line bg-surface" style={{ animationDelay: `${i * 120}ms` }} />
      ))}
    </div>
  );
}
