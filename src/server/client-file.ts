/**
 * Ficha única do cliente: tudo o que aconteceu com a pessoa numa linha do tempo
 * (pré-análise, documentos, visitas, negócios e busca), mais o resumo de "agora".
 *
 * Acesso:
 * - gestão: tudo;
 * - pré-atendimento: tudo, menos observações internas (visita, negócio, busca);
 * - consultora: só o que é dela (visitas, negócios, buscas, pré-análises e pedidos de documentos);
 *   sem nada dela com o cliente, não abre. Atendimento de outra consultora aparece só como aviso.
 */
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { AppError, notFound } from "@/lib/errors";
import { hasGlobalView, isPreService, type AuthzActor } from "@/lib/authz";
import { EVALUATION_LABEL, PRE_STATUS_LABEL, PROPOSAL_STATUS_LABEL } from "@/lib/labels";
import { FELL_LABEL, FOLLOW_UP_LABEL, STAGE_LABEL, situationLabel, type Stage } from "@/lib/deal-stages";
import { canManageDocRequest, type DocItem } from "./doc-requests";
import { SEARCH_CLOSE_LABEL } from "./client-search";

export type TimelineKind = "pre" | "proposal" | "docs" | "visit" | "deal" | "search";
export type Tone = "good" | "bad" | "accent" | "info" | "neutral";
export type TimelineItem = { id: string; at: Date; kind: TimelineKind; title: string; detail?: string; note?: string | null; href?: string; tone: Tone; photoUrl?: string | null };

type Mode = "all" | "pre" | "own";
const SYSTEM_NOTE = /^(Aberta por visita realizada|Novo ciclo \(\d+\) aberto por visita realizada)$/;

function modeOf(a: AuthzActor): Mode {
  return hasGlobalView(a) ? "all" : isPreService(a) ? "pre" : "own";
}

/** Cadastro principal (cliente unido a outro abre o principal). */
export async function resolveClientId(id: string) {
  const c = await db.client.findUnique({ where: { id }, select: { id: true, mergedIntoId: true } });
  if (!c) throw notFound();
  return c.mergedIntoId ?? c.id;
}

export async function clientFile(actor: AuthzActor, clientId: string, now = new Date()) {
  const mode = modeOf(actor);
  const me = actor.id;
  const client = await db.client.findUnique({ where: { id: clientId }, include: { phones: { orderBy: { createdAt: "asc" } } } });
  if (!client) throw notFound();

  const own = mode === "own";
  const visitWhere: Prisma.VisitWhereInput = { clientId, ...(own ? { consultantId: me } : {}) };
  const [visits, opps, searches, presDirect, proposals] = await Promise.all([
    db.visit.findMany({
      where: visitWhere,
      orderBy: { scheduledStart: "desc" },
      select: {
        id: true,
        status: true,
        evaluation: true,
        note: true,
        scheduledStart: true,
        scheduledEnd: true,
        propertyCode: true,
        excluded: true,
        autoCanceled: true,
        preAnalysisId: true,
        opportunityId: true,
        consultantId: true,
        consultant: { select: { name: true } },
        negativeReason: { select: { label: true } },
        property: { select: { photoUrl: true, neighborhood: true } },
      },
    }),
    db.opportunity.findMany({
      where: { clientId, ...(own ? { responsibleId: me } : {}) },
      orderBy: { createdAt: "desc" },
      include: {
        property: { select: { code: true } },
        responsible: { select: { name: true } },
        lostReason: { select: { label: true } },
        events: { orderBy: { createdAt: "asc" }, select: { id: true, createdAt: true, fromStatus: true, toStatus: true, toStage: true, note: true, author: { select: { name: true } } } },
      },
    }),
    db.clientSearch.findMany({ where: { clientId, ...(own ? { consultantId: me } : {}) }, orderBy: { startedAt: "desc" } }),
    db.preAnalysis.findMany({ where: { clientId, ...(own ? { consultantId: me } : {}) }, select: { id: true } }),
    db.proposal.findMany({
      where: { clientId, ...(own ? { consultantId: me } : {}) },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true, createdAt: true, statusAt: true, rentCents: true, counterCents: true, propertyCode: true, resultNote: true, consultant: { select: { name: true } }, createdBy: { select: { name: true } } },
    }),
  ]);
  // pré-análises: ligadas ao cadastro ou que geraram alguma visita deste cliente
  const preIds = [...new Set([...presDirect.map((p) => p.id), ...visits.map((v) => v.preAnalysisId).filter((x): x is string => !!x)])];
  const pres = preIds.length
    ? await db.preAnalysis.findMany({
        where: { id: { in: preIds }, ...(own ? { consultantId: me } : {}) },
        orderBy: { createdAt: "desc" },
        select: { id: true, status: true, createdAt: true, resultAt: true, resultNote: true, missingItems: true, propertyCode: true, purgedAt: true, consultant: { select: { name: true } }, createdBy: { select: { name: true } } },
      })
    : [];
  const docOr: Prisma.DocRequestWhereInput[] = [];
  if (pres.length) docOr.push({ preAnalysisId: { in: pres.map((p) => p.id) } });
  if (visits.length) docOr.push({ visitId: { in: visits.map((v) => v.id) } });
  if (opps.length) docOr.push({ opportunityId: { in: opps.map((o) => o.id) } });
  const docs = docOr.length
    ? (
        await db.docRequest.findMany({
          where: { OR: docOr },
          orderBy: { createdAt: "desc" },
          include: { files: { select: { itemKey: true } }, createdBy: { select: { name: true } } },
        })
      ).filter((r) => mode !== "own" || canManageDocRequest(actor, r))
    : [];

  if (own && !visits.length && !opps.length && !searches.length && !pres.length && !docs.length && !proposals.length) {
    throw new AppError("FORBIDDEN", "Este cliente não tem atendimento seu.");
  }
  // consultora: avisa (sem detalhes) se outra pessoa também atende o cliente
  const othersCount = own ? await db.visit.count({ where: { clientId, consultantId: { not: me } } }) : 0;

  const showNotes = mode !== "pre";
  const canOpenDeals = mode !== "pre";
  const timeline: TimelineItem[] = [];

  for (const p of pres) {
    const href = `/pre-analises/${p.id}`;
    timeline.push({ id: `pre-${p.id}`, at: p.createdAt, kind: "pre", tone: "neutral", title: "Pré-análise enviada", detail: `${p.createdBy.name.split(" ")[0]} enviou para ${p.consultant.name.split(" ")[0]}${p.propertyCode ? ` · imóvel ${p.propertyCode}` : ""}`, href });
    if (p.resultAt && p.status !== "AWAITING") {
      timeline.push({
        id: `pre-r-${p.id}`,
        at: p.resultAt,
        kind: "pre",
        tone: p.status === "APPROVED" ? "good" : p.status === "REJECTED" ? "bad" : "info",
        title: `Pré-análise: ${PRE_STATUS_LABEL[p.status].toLowerCase()}`,
        detail: p.status === "PENDING" && p.missingItems.length ? `Falta: ${p.missingItems.join(", ")}` : undefined,
        note: p.resultNote,
        href,
      });
    }
  }

  const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  for (const p of proposals) {
    const href = `/propostas/${p.id}`;
    timeline.push({ id: `prop-${p.id}`, at: p.createdAt, kind: "proposal", tone: "neutral", title: `Proposta de ${brl(p.rentCents)}`, detail: `${p.createdBy.name.split(" ")[0]} enviou para ${p.consultant.name.split(" ")[0]} · imóvel ${p.propertyCode}`, href });
    if (p.statusAt && p.status !== "NEW") {
      timeline.push({
        id: `prop-s-${p.id}`,
        at: p.statusAt,
        kind: "proposal",
        tone: p.status === "ACCEPTED" ? "good" : p.status === "REJECTED" ? "bad" : "info",
        title: `Proposta: ${PROPOSAL_STATUS_LABEL[p.status].toLowerCase()}`,
        detail: p.status === "COUNTER" && p.counterCents ? `Contraproposta de ${brl(p.counterCents)}` : undefined,
        note: showNotes ? p.resultNote : null,
        href,
      });
    }
  }

  for (const r of docs) {
    const items = r.items as DocItem[];
    const done = items.filter((i) => r.files.some((f) => f.itemKey === i.key)).length;
    const href = r.visitId ? `/visitas/${r.visitId}/documentos` : r.preAnalysisId ? `/pre-analises/${r.preAnalysisId}` : undefined;
    timeline.push({ id: `doc-${r.id}`, at: r.createdAt, kind: "docs", tone: "neutral", title: "Documentos pedidos pelo link", detail: `${items.length} ${items.length === 1 ? "documento" : "documentos"} · por ${r.createdBy.name.split(" ")[0]}`, href });
    if (r.submittedAt) timeline.push({ id: `doc-s-${r.id}`, at: r.submittedAt, kind: "docs", tone: "good", title: "Cliente enviou os documentos", detail: `${done} de ${items.length}`, href });
  }

  for (const v of visits) {
    const past = v.scheduledEnd <= now;
    const title =
      v.status === "DONE"
        ? `Visitou · ${v.evaluation ? EVALUATION_LABEL[v.evaluation].toLowerCase() : "realizada"}`
        : v.status === "NO_SHOW"
          ? "Não compareceu à visita"
          : v.status === "CANCELED"
            ? "Visita cancelada"
            : v.status === "RESCHEDULED"
              ? "Visita remarcada"
              : past
                ? "Visita sem resultado registrado"
                : "Visita agendada";
    const tone: Tone =
      v.status === "DONE" ? (v.evaluation === "POSITIVE" ? "good" : v.evaluation === "NEGATIVE" ? "bad" : "info") : v.status === "SCHEDULED" ? (past ? "accent" : "info") : "neutral";
    timeline.push({
      id: `visit-${v.id}`,
      at: v.scheduledStart,
      kind: "visit",
      tone,
      title,
      detail: [`Imóvel ${v.propertyCode ?? "—"}`, v.property?.neighborhood, v.consultant?.name.split(" ")[0], v.negativeReason?.label].filter(Boolean).join(" · "),
      note: showNotes ? v.note : null,
      href: mode === "pre" ? undefined : `/visitas/${v.id}`,
      photoUrl: v.property?.photoUrl,
    });
  }

  for (const o of opps) {
    for (const e of o.events) {
      const label = e.toStatus === "LOST" ? FELL_LABEL : e.toStage ? STAGE_LABEL[e.toStage as Stage] : e.fromStatus ? FOLLOW_UP_LABEL : "Negócio aberto";
      const tone: Tone = e.toStatus === "LOST" ? "bad" : e.toStatus === "CLOSED_WON" ? "good" : "accent";
      timeline.push({
        id: `deal-${e.id}`,
        at: e.createdAt,
        kind: "deal",
        tone,
        title: label === "Negócio aberto" ? label : `Negócio · ${label}`,
        detail: `Imóvel ${o.property.code}${e.author ? ` · ${e.author.name.split(" ")[0]}` : ""}`,
        // notas automáticas do sistema ("Aberta por visita realizada") não são anotação de ninguém
        note: showNotes && e.note && !SYSTEM_NOTE.test(e.note) ? e.note : null,
        href: canOpenDeals ? `/oportunidades/${o.id}` : undefined,
      });
    }
  }

  for (const s of searches) {
    const href = mode === "pre" ? undefined : `/em-busca/${s.id}`;
    timeline.push({ id: `search-${s.id}`, at: s.startedAt, kind: "search", tone: "accent", title: "Seguiu procurando outro imóvel", detail: "Entrou em Clientes em busca", href });
    if (s.closedAt && s.status !== "ACTIVE") {
      timeline.push({ id: `search-c-${s.id}`, at: s.closedAt, kind: "search", tone: s.status === "WON" ? "good" : "neutral", title: `Busca encerrada · ${SEARCH_CLOSE_LABEL[s.status].toLowerCase()}`, note: showNotes ? s.closeNote : null, href });
    }
  }

  timeline.sort((a, b) => b.at.getTime() - a.at.getTime());

  // ─── agora ───
  const won = opps.find((o) => o.status === "CLOSED_WON");
  const openDeal = opps.find((o) => o.status === "FOLLOW_UP" || o.status === "DOCS_REVIEW");
  const activeSearch = searches.find((s) => s.status === "ACTIVE") ?? null;
  const upcoming = visits.filter((v) => v.status === "SCHEDULED" && !v.excluded && v.scheduledEnd > now).sort((a, b) => a.scheduledStart.getTime() - b.scheduledStart.getTime())[0] ?? null;
  const awaiting = visits.find((v) => v.status === "SCHEDULED" && !v.excluded && v.scheduledEnd <= now) ?? null;
  const openDocs = docs.find((d) => d.status === "OPEN" && !d.purgedAt && d.expiresAt > now) ?? null;
  const lastPre = pres[0] ?? null;
  const lastVisit = visits[0] ?? null;
  const lastDone = visits.find((v) => v.status === "DONE") ?? null;

  const phone = client.phones.find((p) => p.valid && p.normalized)?.normalized ?? null;
  return {
    client,
    mode,
    phone,
    othersCount,
    timeline,
    stats: {
      visits: visits.filter((v) => v.status === "DONE").length,
      properties: new Set(visits.filter((v) => v.status === "DONE").map((v) => v.propertyCode)).size,
      first: [...timeline].pop()?.at ?? null,
    },
    now: {
      won: won ? { id: won.id, code: won.property.code, label: situationLabel({ stage: won.stage as Stage | null, status: won.status }) } : null,
      openDeal: openDeal ? { id: openDeal.id, code: openDeal.property.code, label: situationLabel({ stage: openDeal.stage as Stage | null, status: openDeal.status }), responsible: openDeal.responsible?.name ?? null } : null,
      activeSearch: activeSearch ? { id: activeSearch.id, followUpOn: activeSearch.followUpOn } : null,
      upcoming: upcoming ? { id: upcoming.id, at: upcoming.scheduledStart, code: upcoming.propertyCode } : null,
      awaiting: awaiting ? { id: awaiting.id, at: awaiting.scheduledStart, code: awaiting.propertyCode } : null,
      openDocs: openDocs
        ? {
            href: openDocs.visitId ? `/visitas/${openDocs.visitId}/documentos` : `/pre-analises/${openDocs.preAnalysisId}`,
            done: (openDocs.items as DocItem[]).filter((i) => openDocs.files.some((f) => f.itemKey === i.key)).length,
            total: (openDocs.items as DocItem[]).length,
          }
        : null,
      lastPre: lastPre ? { id: lastPre.id, status: lastPre.status, at: lastPre.createdAt } : null,
    },
    actions: {
      // marcar visita parte da visita mais recente (o reagendamento já puxa o cliente)
      scheduleFrom: mode !== "pre" && lastVisit ? lastVisit.id : null,
      docsFrom: mode !== "pre" && lastDone ? lastDone.id : null,
    },
  };
}

export type ClientFile = Awaited<ReturnType<typeof clientFile>>;
