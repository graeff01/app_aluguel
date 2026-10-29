"use client";
/* eslint-disable @next/next/no-img-element */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { captureIndicateAction } from "@/app/actions/radar";
import { Icon } from "./icons";
import { cx } from "./ui";

export type StripListing = { code: string; category: string | null; neighborhood: string | null; bedrooms: number | null; rentCents: number | null; totalCents: number | null; photoUrl: string | null; url: string };
/** Pedido que pode receber a indicação (só o perfil, sem dados do cliente). */
export type StripPedido = { id: string; label: string; foundCodes: string[] };

const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

/**
 * Imóveis do site em fileira (foto, valor, perfil): a captação vê sem sair do app e indica ao pedido com um toque.
 * Com mais de um pedido no perfil, escolhe para qual.
 */
export function ListingStrip({ items, pedidos, moreUrl }: { items: StripListing[]; pedidos: StripPedido[]; moreUrl?: string }) {
  const [choosing, setChoosing] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const indicate = (pedidoId: string, code: string) =>
    start(async () => {
      const r = await captureIndicateAction(pedidoId, code);
      if (!r.ok) return setErr(r.message ?? "Não foi possível indicar.");
      setErr(null);
      setChoosing(null);
      setDone((d) => ({ ...d, [code]: pedidoId }));
      router.refresh();
    });
  const already = (code: string) => !!done[code] || (pedidos.length > 0 && pedidos.every((p) => p.foundCodes.includes(code)));

  return (
    <div className="min-w-0">
      <ul className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2">
        {items.map((it) => {
          const price = it.totalCents ?? it.rentCents;
          const sent = already(it.code);
          return (
            <li key={it.code} className="w-[180px] shrink-0 snap-start overflow-hidden rounded-2xl border border-line bg-surface">
              <a href={it.url} target="_blank" rel="noopener noreferrer" className="relative block aspect-[4/3] bg-tint" aria-label={`Ver anúncio do imóvel ${it.code} no site`}>
                {it.photoUrl ? (
                  <img src={it.photoUrl} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" className="absolute inset-0 size-full object-cover" />
                ) : (
                  <span className="absolute inset-0 grid place-items-center">
                    <Icon name="home" className="size-7 text-ink-3" />
                  </span>
                )}
                {price ? <span className="num absolute bottom-2 left-2 rounded-full bg-black/70 px-2.5 py-0.5 text-[13px] font-bold text-white">{brl(price)}</span> : null}
              </a>
              <div className="p-2.5">
                <p className="truncate text-[13px] font-semibold">{[it.category, it.bedrooms ? `${it.bedrooms} qto${it.bedrooms > 1 ? "s" : ""}` : null].filter(Boolean).join(" · ") || "Imóvel"}</p>
                <p className="truncate text-[12px] text-ink-3">
                  {it.neighborhood ?? "—"} · <span className="num">{it.code}</span>
                </p>
                {pedidos.length > 0 &&
                  (sent ? (
                    <p className="mt-2 flex min-h-9 items-center text-[13px] font-semibold text-good">✓ Indicado</p>
                  ) : choosing === it.code ? (
                    <div className="mt-2 space-y-1.5">
                      <p className="text-[12px] text-ink-3">Para qual pedido?</p>
                      {pedidos
                        .filter((p) => !p.foundCodes.includes(it.code))
                        .map((p) => (
                          <button key={p.id} type="button" disabled={pending} onClick={() => indicate(p.id, it.code)} className="press block w-full rounded-xl border border-line-strong px-2.5 py-1.5 text-left text-[12px] font-semibold disabled:opacity-50">
                            {p.label}
                          </button>
                        ))}
                      <button type="button" onClick={() => setChoosing(null)} className="text-[12px] font-semibold text-ink-3">
                        Cancelar
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => (pedidos.length === 1 ? indicate(pedidos[0].id, it.code) : setChoosing(it.code))}
                      className="press mt-2 inline-flex min-h-9 w-full items-center justify-center rounded-full bg-primary text-[13px] font-semibold text-on-primary disabled:opacity-50"
                    >
                      Indicar
                    </button>
                  ))}
              </div>
            </li>
          );
        })}
        {moreUrl && (
          <li className="grid w-[120px] shrink-0 snap-start place-items-center">
            <a href={moreUrl} target="_blank" rel="noopener noreferrer" className="press text-center text-[13px] font-semibold text-ink-2 underline underline-offset-2">
              Ver todos no site ↗
            </a>
          </li>
        )}
      </ul>
      {err && (
        <p role="alert" className={cx("mt-1 text-[13px] font-semibold text-bad")}>
          {err}
        </p>
      )}
    </div>
  );
}
