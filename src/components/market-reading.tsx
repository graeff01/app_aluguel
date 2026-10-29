import { listMarketNotes, marketLine, notesForProfile } from "@/server/market";
import { fmt } from "@/lib/time";

/**
 * O que a captação diz do mercado para este perfil: o parecer no próprio pedido (radar) e as leituras do bairro/tipo.
 * Serve de argumento na conversa com o cliente ("nesse valor, só com menos quartos"). Nada aparece se não houver leitura.
 */
export async function MarketReading({ profile, parecer, className = "mb-6" }: { className?: string; profile: { areas: string[]; propertyType: string | null }; parecer?: { tag: string | null; text: string | null; cents: number | null; at: Date | null } }) {
  const notes = notesForProfile(await listMarketNotes(), profile);
  const own = parecer?.tag ? parecer : null;
  if (!own && !notes.length) return null;
  return (
    <section className={`${className} rounded-[26px] border border-warn/30 bg-warn-soft p-5 sm:p-6`} aria-labelledby="t-mercado">
      <h2 id="t-mercado" className="text-[15px] font-bold">
        Leitura de mercado da captação
      </h2>
      <p className="mb-3 text-[13px] text-ink-2">O que o mercado oferece para esse perfil. Use na conversa com o cliente para ajustar valor, quartos ou bairro.</p>
      <ul className="space-y-2 text-[14px]">
        {own && (
          <li className="rounded-2xl bg-surface p-3">
            <strong>Parecer neste pedido:</strong> {marketLine({ tag: own.tag!, text: own.text, cents: own.cents })}
            {own.at ? <span className="text-[12px] text-ink-3"> · {fmt.dateTime(own.at)}</span> : null}
          </li>
        )}
        {notes.map((n) => (
          <li key={n.id} className="rounded-2xl bg-surface p-3">
            <strong>
              {n.type ?? "Qualquer tipo"} · {n.area}:
            </strong>{" "}
            {marketLine(n)}
            <span className="text-[12px] text-ink-3">
              {" "}
              · {n.author ?? "Captação"}, {fmt.shortDate(n.updatedAt).replace(".", "")}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
