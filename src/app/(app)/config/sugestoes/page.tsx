import { requireManager } from "@/lib/require";
import { listDemoFeedback } from "@/server/demo-capture";
import { fmt } from "@/lib/time";
import { Empty, PageHeader } from "@/components/ui";

export const metadata = { title: "Sugestões da demonstração" };

export default async function DemoFeedbackPage() {
  const actor = await requireManager();
  const rows = await listDemoFeedback(actor);
  return (
    <>
      <PageHeader title="Sugestões da demonstração" subtitle="O que foi deixado na demonstração pública da captação, já encerrada (a captação agora usa o app com login)." />
      {rows.length === 0 ? (
        <Empty title="Nenhuma sugestão ainda" icon="✎">
          A demonstração foi encerrada e não chegou nenhuma sugestão.
        </Empty>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.id} className="rounded-3xl border border-line bg-surface p-4 shadow-card">
              <p className="text-[13px] text-ink-3">
                {fmt.dateTime(r.createdAt)} · {r.name ?? "Sem nome"}
              </p>
              <p className="mt-1 text-[15px] whitespace-pre-wrap">{r.text}</p>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
