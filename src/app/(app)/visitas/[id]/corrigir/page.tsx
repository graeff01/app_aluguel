import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActor, orNotFound } from "@/lib/require";
import { getVisitDetail } from "@/server/queries";
import { canCorrectVisitData, hasGlobalView } from "@/lib/authz";
import { toLocalInput } from "@/lib/time";
import { CorrectionForm } from "./form";
import { Panel } from "@/components/ui";
import { db } from "@/lib/db";
import type { ParsedVisit } from "@/lib/parser";
import { ISSUE_LABEL } from "@/lib/parser";

export const metadata = { title: "Corrigir dados" };

export default async function CorrectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ voltar?: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  const { voltar } = await searchParams;
  const { visit, settings } = await orNotFound(getVisitDetail(actor, id));
  if (!canCorrectVisitData(actor, visit, settings)) notFound();
  const src = visit.sourceEventId ? await db.sourceEvent.findUnique({ where: { id: visit.sourceEventId }, select: { parsed: true, title: true } }) : null;
  const p = (src?.parsed ?? null) as ParsedVisit | null;
  return (
    <>
      <Link href={hasGlobalView(actor) ? `/visitas/${visit.id}` : `/visitas/${visit.id}/registrar`} className="mb-4 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-ink-2 hover:text-ink">
        ← Voltar
      </Link>
      <h1 className="mb-1 text-2xl font-bold">Corrigir dados da visita</h1>
      <p className="mb-5 text-ink-2">Use só quando algo estiver errado ou faltando. Correções ficam registradas e a agenda não as sobrescreve.</p>
      {src?.title && (
        <Panel className="mb-5">
          <p className="text-sm text-ink-3">Título na agenda</p>
          <p className="break-words">{src.title}</p>
          {p && p.issues.length > 0 && <p className="mt-2 text-sm text-warn">Problemas detectados: {p.issues.map((i) => ISSUE_LABEL[i]).join(", ")}.</p>}
        </Panel>
      )}
      <CorrectionForm
        visitId={visit.id}
        version={visit.version}
        back={voltar === "registrar" ? "registrar" : ""}
        manual={visit.origin === "MANUAL"}
        initial={{
          clientName: visit.clientName ?? "",
          phoneRaw: visit.phoneRaw ?? "",
          propertyCode: visit.propertyCode ?? "",
          scheduledStart: toLocalInput(visit.scheduledStart),
          scheduledEnd: toLocalInput(visit.scheduledEnd),
        }}
      />
    </>
  );
}
