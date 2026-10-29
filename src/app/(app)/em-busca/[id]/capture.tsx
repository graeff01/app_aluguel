import { captureForSearch, OUTCOME_TONE, outcomeText } from "@/server/capture";
import { marketLine } from "@/server/market";
import { RADAR_CLOSE_REASONS } from "@/server/radar";
import { propertyUrl } from "@/server/property-preview";
import { getSettings } from "@/lib/settings";
import { fmt } from "@/lib/time";
import { cx } from "@/components/ui";
import { CloseCaptureForm, RequestCaptureForm } from "./capture-forms";

const TONE_CLS = { neutral: "bg-tint text-ink-2", bad: "bg-bad-soft text-bad", warn: "bg-warn-soft text-warn", good: "bg-good-soft text-good" } as const;

/** Cliente em busca × captação: pedir, acompanhar quem está buscando, o parecer e os imóveis indicados. */
export async function SearchCapture({ search }: { search: { id: string; note: string | null; mustNot: string | null } }) {
  const [r, settings] = await Promise.all([captureForSearch(search.id), getSettings()]);
  const open = r && r.status !== "CLOSED";
  return (
    <section className="mt-6 rounded-[26px] border border-line bg-surface p-5 shadow-card sm:p-6" aria-labelledby="t-captacao">
      <h2 id="t-captacao" className="text-[17px] font-bold">
        Captação
      </h2>
      {!open ? (
        <>
          <p className="mb-3 text-[13px] text-ink-3">
            {r ? `Último pedido encerrado${r.closeReason ? `: ${r.closeReason}` : ""}. ` : ""}
            Não achou no site? Peça à captação: ela busca imóveis fora da base e avisa você quando indicar um.
          </p>
          <RequestCaptureForm searchId={search.id} initial={[search.note, search.mustNot ? `Não quer: ${search.mustNot}` : null].filter(Boolean).join("\n")} again={!!r} />
        </>
      ) : (
        <>
          <p className="mt-1 text-[14px]">
            Com a captação desde {fmt.shortDate(r.sentToCaptureAt!).replace(".", "")} ·{" "}
            <strong className={r.captureOwner ? "text-accent-strong" : "text-ink-2"}>{r.captureOwner ? `🔎 ${r.captureOwner.name.split(" ")[0]} está buscando` : "aguardando alguém pegar"}</strong>
          </p>
          {r.marketTag && (
            <p className="mt-2 rounded-xl border border-warn/30 bg-warn-soft px-3 py-2 text-[13px]">
              <strong>Parecer da captação:</strong> {marketLine({ tag: r.marketTag, text: r.marketNote, cents: r.marketCents })}
            </p>
          )}
          {r.indications.length > 0 ? (
            <ul className="mt-3 space-y-1.5">
              {r.indications.map((i) => (
                <li key={i.code} className="flex flex-wrap items-center gap-2 text-[14px]">
                  <a href={propertyUrl(settings.propertyUrlTemplate, i.code)} target="_blank" rel="noopener noreferrer" className="num font-semibold underline underline-offset-2">
                    Imóvel {i.code}
                  </a>
                  <span className="text-[12px] text-ink-3">indicado por {i.by.name.split(" ")[0]}</span>
                  <span className={cx("rounded-full px-2 py-0.5 text-[12px] font-semibold", TONE_CLS[OUTCOME_TONE[i.result.outcome]])}>{outcomeText(i.result)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[13px] text-ink-3">Nenhum imóvel indicado ainda. Você recebe um aviso quando chegar.</p>
          )}
          <CloseCaptureForm id={r.id} reasons={[...RADAR_CLOSE_REASONS]} />
        </>
      )}
    </section>
  );
}
