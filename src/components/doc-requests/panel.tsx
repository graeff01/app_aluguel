import { DOC_ITEM_PRESETS, docRequestShare, listDocRequests, suggestedItemKeys } from "@/server/doc-requests";
import type { AuthzActor } from "@/lib/authz";
import { fmt } from "@/lib/time";
import { cx } from "@/components/ui";
import { InlineAction } from "@/components/inline-action";
import { cancelDocRequestAction, renewDocRequestAction } from "@/app/actions/doc-requests";
import { docShareMessage, whatsappUrl } from "@/lib/doc-share";
import { DocRequestForm } from "./request-form";
import { ShareButtons } from "./share-buttons";

const STATUS: Record<string, [string, string]> = {
  OPEN: ["Aguardando o cliente", "bg-accent-soft text-accent-strong"],
  SUBMITTED: ["Enviado pelo cliente", "bg-good-soft text-good"],
  EXPIRED: ["Link expirado", "bg-tint text-ink-2"],
  CANCELED: ["Cancelado", "bg-tint text-ink-3"],
};
const sizeLabel = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/** "Documentos pelo link": pedir, acompanhar e abrir o que o cliente enviou (pré-análise ou visita). */
export async function DocRequestsPanel({
  actor,
  target,
  guaranteeLabel,
  hasPhone,
  title = "Documentos pelo link do cliente",
  intro,
}: {
  actor: AuthzActor & { name: string };
  target: { preAnalysisId?: string; visitId?: string; opportunityId?: string | null };
  guaranteeLabel?: string | null;
  hasPhone: boolean;
  title?: string;
  intro?: string;
}) {
  const now = new Date();
  const list = await listDocRequests(actor, { preAnalysisId: target.preAnalysisId, visitId: target.visitId, opportunityId: target.opportunityId ?? undefined }, now);
  const active = list.find((r) => r.status === "OPEN" || r.status === "SUBMITTED" || r.status === "EXPIRED");
  const share = active && !active.purgedAt ? await docRequestShare(actor, active.id).catch(() => null) : null;
  const formTarget = target.preAnalysisId ? { preAnalysisId: target.preAnalysisId } : { visitId: target.visitId };

  return (
    <section className="mb-6 rounded-[26px] border border-line bg-surface p-5 shadow-card sm:p-6" aria-labelledby="t-doclink">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="t-doclink" className="text-[15px] font-bold">
            {title}
          </h2>
          <p className="text-[13px] text-ink-3">{intro ?? "O cliente fotografa e envia pelo celular, num link seguro. Você é avisada quando ele concluir."}</p>
        </div>
      </div>

      {list.map((r) => {
        const [label, cls] = STATUS[r.status];
        const isActive = r.id === active?.id;
        return (
          <div key={r.id} className={cx("mb-4 rounded-2xl border p-4", isActive ? "border-line-strong" : "border-line opacity-80")}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className={cx("inline-flex rounded-full px-3 py-1 text-[12px] font-bold", cls)}>{label}</span>
              <span className="num text-[13px] font-semibold text-ink-2">
                {r.done} de {r.total} documentos
              </span>
            </div>
            <p className="mt-2 text-[12px] text-ink-3">
              Pedido por {r.createdBy.split(" ")[0]} em {fmt.dateTime(r.createdAt)}
              {r.verifiedAt ? ` · cliente abriu em ${fmt.dateTime(r.verifiedAt)}` : r.openedAt ? " · link aberto, identidade não confirmada" : " · ainda não abriu"}
              {r.submittedAt ? ` · concluído em ${fmt.dateTime(r.submittedAt)}` : r.status === "OPEN" ? ` · vale até ${fmt.date(r.expiresAt)}` : ""}
            </p>
            {r.lockedUntil && <p className="mt-2 rounded-xl bg-warn-soft px-3 py-2 text-[13px] font-semibold text-warn">Bloqueado por tentativas erradas até {fmt.time(r.lockedUntil)}. “Renovar prazo” desbloqueia.</p>}
            {r.purgedAt ? (
              <p className="mt-2 text-[13px] text-ink-3">Arquivos apagados em {fmt.date(r.purgedAt)} (prazo da LGPD).</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {r.items.map((i) => (
                  <li key={i.key} className="rounded-xl bg-surface-2 px-3.5 py-2.5">
                    <p className="flex items-center gap-2 text-[14px] font-semibold">
                      <span aria-hidden className={cx("grid size-5 place-items-center rounded-full text-[11px] font-bold", i.files.length ? "bg-good text-bg" : "bg-tint text-ink-3")}>
                        {i.files.length ? "✓" : "·"}
                      </span>
                      {i.label}
                      {!i.required && <span className="text-[11px] font-normal text-ink-3">(opcional)</span>}
                    </p>
                    {i.files.length > 0 && (
                      <ul className="mt-1.5 ml-7 space-y-1">
                        {i.files.map((f) => (
                          <li key={f.id} className="flex flex-wrap items-center gap-x-3 text-[13px]">
                            <a href={`/api/documentos/${f.id}`} target="_blank" rel="noopener" className="font-semibold underline underline-offset-4">
                              {f.mime === "application/pdf" ? "📄" : "🖼️"} {f.name}
                            </a>
                            <span className="text-ink-3">{sizeLabel(f.size)}</span>
                            <a href={`/api/documentos/${f.id}?baixar=1`} className="text-ink-3 underline underline-offset-4">
                              baixar
                            </a>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {isActive && share && (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <ShareButtons url={share.url} whatsapp={whatsappUrl(share.phone, docShareMessage({ clientName: share.clientName, sender: actor.name, url: share.url, verify: null }))} />
                {r.status !== "SUBMITTED" && <InlineAction action={renewDocRequestAction} fields={{ id: r.id }} label="Renovar prazo" />}
                <InlineAction action={cancelDocRequestAction} fields={{ id: r.id }} label="Cancelar link" variant="ghost" confirm="Cancelar este link? O cliente não conseguirá mais abrir. Os arquivos já enviados continuam aqui." />
              </div>
            )}
          </div>
        );
      })}

      <DocRequestForm
        target={formTarget}
        presets={DOC_ITEM_PRESETS}
        suggested={suggestedItemKeys(guaranteeLabel)}
        hasPhone={hasPhone}
      />
      {active && active.status !== "CANCELED" && <p className="mt-2 text-[12px] text-ink-3">Pedir mais documentos inclui os novos no mesmo link que o cliente já tem.</p>}
    </section>
  );
}
