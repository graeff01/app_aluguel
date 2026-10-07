import type { NextRequest } from "next/server";
import { getActor } from "@/lib/session";
import { canViewDashboard } from "@/lib/authz";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { historyWhere } from "@/server/queries";
import { fmt, dayKey } from "@/lib/time";
import { formatPhone } from "@/lib/phone";
import { EVALUATION_LABEL, STATUS_LABEL } from "@/lib/labels";
import { csvCell as cell } from "@/lib/csv";

const MAX_ROWS = 20_000;

/** Exportação CSV dos registros filtrados (somente gestão). */
export async function GET(req: NextRequest) {
  const actor = await getActor();
  if (!actor || actor.mustChangePassword) return new Response("Não autenticado", { status: 401 });
  if (!canViewDashboard(actor)) return new Response("Sem permissão", { status: 403 });
  const sp = req.nextUrl.searchParams;
  const filter = { q: sp.get("q") ?? undefined, from: sp.get("de") ?? undefined, to: sp.get("ate") ?? undefined, status: sp.get("situacao") ?? undefined, consultantId: sp.get("consultora") ?? undefined };
  const rows = await db.visit.findMany({
    where: historyWhere(actor, filter),
    orderBy: { scheduledStart: "asc" },
    take: MAX_ROWS,
    include: {
      consultant: { select: { name: true } },
      negativeReason: { select: { label: true } },
      concludedBy: { select: { name: true } },
      client: { select: { identityStatus: true } },
      opportunity: { select: { status: true } },
    },
  });
  await db.$transaction((tx) =>
    audit(tx, { actorId: actor.id, action: "export.visits_csv", entityType: "Visit", entityId: "-", changes: { linhas: rows.length, filtros: filter } }),
  );

  const header = ["Data", "Início", "Fim", "Consultora", "Cliente", "Telefone", "Telefone validado", "Imóvel", "Situação", "Avaliação", "Motivo (negativa)", "Observação", "Registrado em", "Registrado por", "Origem", "Identificação do cliente", "Excluída dos indicadores"];
  const lines = [header.map(cell).join(";")];
  for (const v of rows) {
    lines.push(
      [
        fmt.date(v.scheduledStart),
        fmt.time(v.scheduledStart),
        fmt.time(v.scheduledEnd),
        v.consultant?.name ?? "",
        v.clientName ?? "",
        v.phoneNormalized ? formatPhone(v.phoneNormalized) : (v.phoneRaw ?? ""),
        v.phoneNormalized ? "sim" : "não",
        v.propertyCode ?? "",
        v.status === "SCHEDULED" && v.scheduledEnd <= new Date() ? "Aguardando resultado" : STATUS_LABEL[v.status],
        v.evaluation ? EVALUATION_LABEL[v.evaluation] : "",
        v.negativeReason?.label ?? "",
        v.note ?? "",
        v.concludedAt ? fmt.dateTime(v.concludedAt) : "",
        v.concludedBy?.name ?? (v.autoCanceled ? "Agenda Google" : ""),
        v.origin === "GOOGLE" ? "Agenda" : "Manual",
        v.client?.identityStatus === "CONFIRMED" ? "Confirmada" : v.client ? "Pendente" : "",
        v.excluded ? "sim" : "não",
      ]
        .map(cell)
        .join(";"),
    );
  }
  const body = "﻿" + lines.join("\r\n") + "\r\n"; // BOM: acentos corretos no Excel
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="visitas-${dayKey(new Date())}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
