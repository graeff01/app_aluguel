export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Carregando" className="animate-pulse">
      <div className="mb-2 h-4 w-40 rounded-full bg-tint" />
      <div className="mb-8 h-9 w-64 rounded-full bg-tint" />
      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-20 rounded-3xl bg-tint" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="h-72 rounded-[26px] bg-tint" />
        ))}
      </div>
    </div>
  );
}
