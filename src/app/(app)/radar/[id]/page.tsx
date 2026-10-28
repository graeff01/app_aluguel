import Link from "next/link";
import { notFound } from "next/navigation";
import { ClientFileLink } from "@/components/client-file-link";
import { requireActor, orNotFound } from "@/lib/require";
import { RADAR_CLOSE_REASONS, RADAR_STATUS_LABEL, canUseRadar, isRadarDue, radarAgeDays, radarDetail } from "@/server/radar";
import { brl } from "@/server/proposals";
import { dateOnlyKey, fmt } from "@/lib/time";
import { formatPhone } from "@/lib/phone";
import { PageHeader, cx } from "@/components/ui";
import { ContactButtons } from "@/components/contact-buttons";
import { RadarCloseForm, RadarReopen, RadarUpdateForm } from "./forms";

export const metadata = { title: "Radar de clientes" };

export default async function RadarItemPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ novo?: string }> }) {
  const actor = await requireActor({ preService: true });
  if (!canUseRadar(actor)) notFound();
  const { id } = await params;
  const sp = await searchParams;
  const r = await orNotFound(radarDetail(actor, id));
  const now = new Date();
  const closed = r.status === "CLOSED";
  const due = isRadarDue(r, now);
  const profile: [string, string][] = [
    ["Tipo", r.propertyType ?? "Qualquer"],
    ["Quartos", r.bedrooms ? String(r.bedrooms) : "—"],
    ["Valor máximo", r.maxBudgetCents ? brl(r.maxBudgetCents) : "—"],
    ["Regiões", r.areas.length ? r.areas.join(", ") : "—"],
  ];
  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/radar" className="mb-4 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-ink-2 hover:text-ink">
        ← Radar de clientes
      </Link>
      {sp.novo && <p role="status" className="mb-5 rounded-2xl bg-good-soft px-4 py-3 text-sm font-semibold text-good">✓ Cliente no radar. O app avisa você no dia de cobrar.</p>}
      <PageHeader
        eyebrow="Radar de clientes"
        title={r.clientName}
        subtitle={`Cadastrado por ${r.createdBy.name} · ${fmt.dateTime(r.createdAt)}`}
        action={
          <span className={cx("inline-flex rounded-full px-3 py-1 text-[13px] font-bold", r.status === "FOUND" ? "bg-good-soft text-good" : closed ? "bg-tint text-ink-2" : "bg-accent-soft text-accent-strong")}>
            {closed ? (r.closeReason ?? RADAR_STATUS_LABEL.CLOSED) : RADAR_STATUS_LABEL[r.status]}
          </span>
        }
      />
      <ClientFileLink clientId={r.clientId} className="-mt-2 mb-5" />

      <section className="mb-6 rounded-[26px] border border-line bg-surface p-5 shadow-card sm:p-6">
        <p className="text-[12px] font-semibold tracking-wide text-ink-3 uppercase">O que procura</p>
        <p className="mt-1 text-[17px] leading-snug font-semibold whitespace-pre-wrap">{r.wants}</p>
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-line pt-4 sm:grid-cols-4">
          {profile.map(([k, v]) => (
            <div key={k}>
              <dt className="text-[12px] font-semibold tracking-wide text-ink-3 uppercase">{k}</dt>
              <dd className="text-[15px] font-semibold">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-4 border-t border-line pt-4">
          <p className="text-[12px] font-semibold tracking-wide text-ink-3 uppercase">Telefone</p>
          <p className="text-[16px] font-semibold">{r.purgedAt ? <span className="text-ink-3">apagado (prazo da LGPD)</span> : r.phone ? formatPhone(r.phone) : "—"}</p>
          {!r.purgedAt && r.phone && <ContactButtons phone={r.phone} name={r.clientName.split(" ")[0] || "cliente"} className="mt-3" />}
        </div>
        <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4 text-[13px]">
          <span className="rounded-full bg-tint px-3 py-1">{r.sentToCaptureAt ? `Com a captação desde ${fmt.shortDate(r.sentToCaptureAt)} (${radarAgeDays(r, now)} d)` : "Ainda não passou à captação"}</span>
          {!closed && <span className={cx("rounded-full px-3 py-1 font-semibold", due ? "bg-bad-soft text-bad" : "bg-tint")}>{due ? "Cobrar hoje" : `Cobrar em ${dateOnlyKey(r.followUpOn).split("-").reverse().join("/")}`}</span>}
          {r.foundCodes.length > 0 && <span className="rounded-full bg-good-soft px-3 py-1 font-semibold text-good">Imóveis achados: {r.foundCodes.join(", ")}</span>}
        </div>
      </section>

      {!closed ? (
        <>
          <section className="mb-6 rounded-[26px] border border-line bg-surface p-5 shadow-card sm:p-6">
            <h2 className="mb-3 text-[15px] font-bold">Registrar atualização</h2>
            <RadarUpdateForm id={r.id} sent={!!r.sentToCaptureAt} />
          </section>
          <section className="mb-6 rounded-[26px] border border-line bg-surface p-5 shadow-card sm:p-6">
            <h2 className="mb-3 text-[15px] font-bold">Encerrar</h2>
            <RadarCloseForm id={r.id} reasons={[...RADAR_CLOSE_REASONS]} />
          </section>
        </>
      ) : (
        <section className="mb-6 rounded-[26px] border border-line bg-surface p-5 shadow-card sm:p-6">
          <p className="text-[15px]">
            <strong>{r.closeReason}</strong>
            {r.closedBy ? ` · ${r.closedBy.name}` : ""}
            {r.closedAt ? ` · ${fmt.dateTime(r.closedAt)}` : ""}
          </p>
          {r.closeNote && <p className="mt-1 text-sm text-ink-2">“{r.closeNote}”</p>}
          {!r.purgedAt && <RadarReopen id={r.id} />}
        </section>
      )}

      <section className="mb-6">
        <h2 className="mb-3 text-[15px] font-bold">Histórico</h2>
        <ol className="space-y-2">
          {r.events.map((e) => (
            <li key={e.id} className="rounded-2xl border border-line bg-surface p-4 shadow-card">
              <p className="text-sm text-ink-3">
                {fmt.dateTime(e.createdAt)} · {e.author?.name ?? "Sistema"}
              </p>
              <p className="whitespace-pre-wrap">{e.note}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
