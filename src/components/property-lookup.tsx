"use client";
/* eslint-disable @next/next/no-img-element */
import { useEffect, useState } from "react";

type Pv = { status: string; photoUrl?: string | null; title?: string | null; url?: string | null; neighborhood?: string | null; category?: string | null; totalPrice?: number | null; rent?: number | null };

/** Confirma o imóvel enquanto digita o código: foto e título do anúncio. */
export function PropertyLookup({ code }: { code: string }) {
  const [pv, setPv] = useState<Pv | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const c = code.trim();
    if (c.length < 3) return setPv(null);
    setLoading(true);
    const ctl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/properties/preview?codigo=${encodeURIComponent(c)}`, { signal: ctl.signal, headers: { "x-requested-with": "visitas" } })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => setPv(d))
        .catch(() => undefined)
        .finally(() => setLoading(false));
    }, 600);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [code]);
  if (code.trim().length < 3) return null;
  if (loading && !pv) return <p className="mt-2 text-[13px] text-ink-3">Buscando o imóvel no site…</p>;
  if (!pv) return null;
  if (pv.status === "OK")
    return (
      <div className="animate-rise mt-2.5 flex items-center gap-3 rounded-2xl border border-line bg-surface-2 p-2.5">
        {pv.photoUrl ? <img src={pv.photoUrl} alt="" referrerPolicy="no-referrer" className="size-14 shrink-0 rounded-xl object-cover" /> : null}
        <div className="min-w-0">
          <p className="text-[12px] font-bold text-good">✓ Imóvel encontrado</p>
          <p className="line-clamp-2 text-[13px] text-ink-2">{pv.title}</p>
          {(pv.neighborhood || pv.totalPrice || pv.rent) && (
            <p className="text-[12px] font-semibold text-ink-3">
              {[pv.neighborhood, (pv.totalPrice ?? pv.rent) ? `${(pv.totalPrice ?? pv.rent)!.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })}${pv.totalPrice ? " total" : ""}` : null].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>
      </div>
    );
  if (pv.status === "NOT_FOUND") return <p className="mt-2 text-[13px] font-semibold text-warn">Código não encontrado no site — confira se está certo (pode ser imóvel fora do ar).</p>;
  return null;
}
