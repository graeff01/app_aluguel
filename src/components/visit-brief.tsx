/* eslint-disable @next/next/no-img-element */
import { cx } from "./ui";
import { Icon } from "./icons";
import { fmt } from "@/lib/time";
import { EVALUATION_LABEL, STATUS_LABEL } from "@/lib/labels";
import type { VisitBriefData } from "@/server/brief";

const brl = (n: number | null | undefined) => (n ? n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }) : null);
const TONE = { good: "bg-good-soft text-good", warn: "bg-accent-soft text-accent-strong", info: "bg-tint text-ink-2" } as const;
const EVAL_CLS: Record<string, string> = { POSITIVE: "text-good", NEGATIVE: "text-bad", UNDECIDED: "text-ink-3" };

/** "Antes de entrar": imóvel, pontos para a conversa e histórico do cliente. */
export function VisitBrief({ data, siteUrl, open }: { data: VisitBriefData; siteUrl: string | null; open: boolean }) {
  const p = data.property;
  const photos = p ? (p.photos.length ? p.photos : p.photoUrl ? [p.photoUrl] : []) : [];
  const facts: [string, string | null][] = p
    ? [
        ["Aluguel", brl(p.rent)],
        ["Condomínio", brl(p.condoFee)],
        ["IPTU", brl(p.iptu)],
        ["Área", p.area ? `${p.area} m²` : null],
        ["Quartos", p.bedrooms ? String(p.bedrooms) : null],
        ["Bairro", p.neighborhood],
      ]
    : [];
  const shown = facts.filter(([, v]) => v);
  return (
    <details open={open} className="group mb-6 overflow-hidden rounded-[26px] border border-line bg-surface shadow-card">
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-5 py-3">
        <span>
          <span className="block text-[12px] font-bold tracking-[0.12em] text-accent-strong uppercase">Antes de entrar</span>
          <span className="text-[15px] font-semibold">Ficha do imóvel e do cliente</span>
        </span>
        <span aria-hidden className="text-xl text-ink-3 transition-transform group-open:rotate-45">+</span>
      </summary>

      {photos.length > 0 && (
        <div className="flex snap-x snap-mandatory gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none]">
          {photos.map((src, i) => (
            <img
              key={src}
              src={src}
              alt={i === 0 ? `Foto do imóvel ${p?.code}` : ""}
              loading={i < 2 ? "eager" : "lazy"}
              decoding="async"
              referrerPolicy="no-referrer"
              className={cx("h-40 shrink-0 snap-start rounded-2xl bg-tint object-cover", photos.length === 1 ? "w-full" : "w-[78%] max-w-[300px]")}
            />
          ))}
        </div>
      )}

      <div className="px-5 pt-4 pb-5">
        {p && (
          <>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="num text-[17px] font-bold">
                  {p.code}
                  {p.category ? <span className="font-medium text-ink-3"> · {p.category}</span> : null}
                </p>
                {p.title && <p className="line-clamp-2 text-[13px] text-ink-3">{p.title}</p>}
              </div>
              {siteUrl && (
                <a href={siteUrl} target="_blank" rel="noopener noreferrer" className="press inline-flex min-h-10 shrink-0 items-center gap-1 rounded-full border border-line-strong px-3.5 text-[13px] font-semibold">
                  Anúncio <span aria-hidden>↗</span>
                </a>
              )}
            </div>
            {(p.totalPrice || p.rent) && (
              <p className="mt-3 flex items-baseline gap-2">
                <span className="num text-[26px] leading-none font-bold tracking-[-0.02em]">{brl(p.totalPrice ?? p.rent)}</span>
                <span className="text-[13px] text-ink-3">{p.totalPrice ? "total por mês com encargos" : "aluguel por mês"}</span>
              </p>
            )}
            {shown.length > 0 && (
              <dl className="mt-3 grid grid-cols-3 gap-2">
                {shown.map(([k, v]) => (
                  <div key={k} className="rounded-2xl bg-tint px-3 py-2">
                    <dt className="text-[11px] font-semibold tracking-wide text-ink-3 uppercase">{k}</dt>
                    <dd className="num truncate text-[14px] font-semibold">{v}</dd>
                  </div>
                ))}
              </dl>
            )}
            {!shown.length && <p className="mt-2 text-[13px] text-ink-3">Dados do anúncio ainda não carregados.</p>}
          </>
        )}

        {data.points.length > 0 && (
          <section aria-labelledby="t-pontos" className="mt-5">
            <h3 id="t-pontos" className="mb-2 text-[12px] font-bold tracking-[0.12em] text-ink-3 uppercase">
              Pontos para a conversa
            </h3>
            <ul className="space-y-2">
              {data.points.map((pt, i) => (
                <li key={i} className={cx("rounded-2xl px-3.5 py-2.5 text-[14px] leading-snug font-medium", TONE[pt.tone])}>
                  {pt.text}
                </li>
              ))}
            </ul>
          </section>
        )}

        {data.history.length > 0 && (
          <section aria-labelledby="t-hist" className="mt-5">
            <h3 id="t-hist" className="mb-2 text-[12px] font-bold tracking-[0.12em] text-ink-3 uppercase">
              Visitas anteriores do cliente
            </h3>
            <ol className="space-y-2">
              {data.history.map((h) => (
                <li key={h.id} className="flex gap-3 rounded-2xl border border-line px-3.5 py-2.5">
                  {h.property?.photoUrl ? (
                    <img src={h.property.photoUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-11 shrink-0 rounded-xl object-cover" />
                  ) : (
                    <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-tint">
                      <Icon name="home" className="size-5 text-ink-3" />
                    </span>
                  )}
                  <div className="min-w-0 flex-1 text-[13px]">
                    <p className="flex flex-wrap items-baseline gap-x-2">
                      <span className="num font-bold text-ink">{h.propertyCode ?? "sem código"}</span>
                      <span className="text-ink-3">{fmt.date(h.scheduledStart)}</span>
                      <span className={cx("font-semibold", h.evaluation ? EVAL_CLS[h.evaluation] : "text-ink-3")}>
                        {h.evaluation ? EVALUATION_LABEL[h.evaluation] : STATUS_LABEL[h.status]}
                      </span>
                    </p>
                    <p className="text-ink-3">
                      {[h.property?.neighborhood, brl(h.property?.totalPrice ?? h.property?.rent), h.property?.area ? `${h.property.area} m²` : null].filter(Boolean).join(" · ")}
                    </p>
                    {h.negativeReason && <p className="text-ink-2">Motivo: {h.negativeReason.label}</p>}
                    {h.note && <p className="mt-0.5 line-clamp-2 text-ink-2">“{h.note}”</p>}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        )}

        {p && data.stats.done > 0 && (
          <p className="mt-5 rounded-2xl bg-tint px-3.5 py-2.5 text-[13px] text-ink-2">
            <strong className="text-ink">Este imóvel na equipe:</strong> {data.stats.done} {data.stats.done === 1 ? "visita realizada" : "visitas realizadas"} · {data.stats.positive} gostaram · {data.stats.negative} não gostaram
            {data.stats.noShow ? ` · ${data.stats.noShow} faltaram` : ""}
          </p>
        )}
        {p?.address && (
          <p className="mt-3 flex items-start gap-2 text-[13px] text-ink-2">
            <Icon name="pin" className="mt-0.5 size-4 shrink-0 text-ink-3" /> {p.address}
          </p>
        )}
      </div>
    </details>
  );
}
