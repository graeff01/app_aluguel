import { requireActor } from "@/lib/require";
import { listAlerts } from "@/server/alerts";
import { openAlertAction, readAllAlertsAction } from "@/app/actions/alerts";
import { fmt } from "@/lib/time";
import { Empty, PageHeader, cx } from "@/components/ui";

export const metadata = { title: "Avisos" };

export default async function AlertsPage() {
  const actor = await requireActor({ preService: true, marketing: true, capture: true });
  const rows = await listAlerts(actor);
  const unread = rows.filter((r) => !r.readAt).length;
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Avisos"
        subtitle="O que a captação e o atendimento atualizaram para você. Cada aviso fica aqui até você abrir."
        action={
          unread > 0 ? (
            <form action={readAllAlertsAction}>
              <button className="press inline-flex min-h-10 items-center rounded-full border border-line-strong px-4 text-[13px] font-semibold">Marcar todos como lidos</button>
            </form>
          ) : null
        }
      />
      {rows.length === 0 ? (
        <Empty title="Nenhum aviso" icon="✓">
          Quando a captação ou o atendimento atualizar um pedido seu, o aviso aparece aqui e no topo do app.
        </Empty>
      ) : (
        <ul className="space-y-2">
          {rows.map((a) => (
            <li key={a.id}>
              <form action={openAlertAction}>
                <input type="hidden" name="id" value={a.id} />
                <button className={cx("press block w-full rounded-2xl border p-4 text-left shadow-card", a.readAt ? "border-line bg-surface" : "border-accent/40 bg-accent-soft")}>
                  <span className="flex items-start justify-between gap-3">
                    <span className="text-[15px] font-bold">
                      {!a.readAt && <span aria-hidden className="mr-2 inline-block size-2.5 rounded-full bg-accent align-middle" />}
                      {a.title}
                    </span>
                    <span className="shrink-0 text-[12px] text-ink-3">{fmt.dateTime(a.createdAt)}</span>
                  </span>
                  <span className="mt-1 block text-[14px] text-ink-2">{a.body}</span>
                  <span className="mt-2 block text-[13px] font-semibold text-accent-strong">{a.readAt ? "Ver de novo →" : "Abrir →"}</span>
                  {!a.readAt && <span className="sr-only">(não lido)</span>}
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
