/**
 * Autorização centralizada. TODA consulta/mutação de visitas, clientes e oportunidades passa por aqui.
 * Para mudar quem pode atualizar andamento etc., altere as regras abaixo ou as chaves em AppSettings.
 */
import type { Prisma } from "@/generated/prisma/client";
import type { Role } from "@/generated/prisma/enums";
import { forbidden } from "./errors";

export type AuthzActor = { id: string; role: Role };
export type PermissionSettings = {
  consultantCanUpdateOpp: boolean;
  consultantCanCreateVisit: boolean;
  consultantCanCorrectData: boolean;
};

export const isAdmin = (a: AuthzActor) => a.role === "ADMIN";
/** Gestora e admin têm visão global da operação. */
export const hasGlobalView = (a: AuthzActor) => a.role === "ADMIN" || a.role === "MANAGER";

/** Filtro obrigatório para qualquer leitura de visitas. */
export function visitScope(a: AuthzActor): Prisma.VisitWhereInput {
  return hasGlobalView(a) ? {} : { consultantId: a.id };
}

/** Oportunidades visíveis: globais para gestão; para consultora, apenas as de sua responsabilidade. */
export function opportunityScope(a: AuthzActor): Prisma.OpportunityWhereInput {
  return hasGlobalView(a) ? {} : { responsibleId: a.id };
}

type VisitLike = { consultantId: string | null };
type OppLike = { responsibleId: string | null };

export function canViewVisit(a: AuthzActor, v: VisitLike) {
  return hasGlobalView(a) || (v.consultantId !== null && v.consultantId === a.id);
}

/** Registrar/alterar resultado: consultora responsável ou gestão. */
export function canConcludeVisit(a: AuthzActor, v: VisitLike) {
  return canViewVisit(a, v);
}

export function canCorrectVisitData(a: AuthzActor, v: VisitLike, s: PermissionSettings) {
  return hasGlobalView(a) || (s.consultantCanCorrectData && v.consultantId === a.id);
}

export function canCreateManualVisit(a: AuthzActor, s: PermissionSettings) {
  return hasGlobalView(a) || (a.role === "CONSULTANT" && s.consultantCanCreateVisit);
}

export const canAssignVisit = hasGlobalView;
export const canReview = hasGlobalView;
export const canManageClients = hasGlobalView;
export const canViewDashboard = hasGlobalView;
/** Listas e motivos (inclui agenciadores e garantias): gestão. */
export const canManageReasons = hasGlobalView;
export const canViewAudit = isAdmin;
export const canManageIntegration = isAdmin;
export const canManageSettings = isAdmin;
export const canTriggerSync = hasGlobalView;

export function canViewOpportunity(a: AuthzActor, o: OppLike) {
  return hasGlobalView(a) || (o.responsibleId !== null && o.responsibleId === a.id);
}

/** Andamento posterior: responsável (se habilitado) e gestão. Transferência de responsável: só gestão. */
export function canUpdateOpportunity(a: AuthzActor, o: OppLike, s: PermissionSettings) {
  return hasGlobalView(a) || (s.consultantCanUpdateOpp && o.responsibleId === a.id);
}

/** Gestora gerencia consultoras e o pré-atendimento; admin gerencia todos. */
export function canManageUser(a: AuthzActor, targetRole: Role) {
  if (isAdmin(a)) return true;
  return a.role === "MANAGER" && (targetRole === "CONSULTANT" || targetRole === "PRE_SERVICE" || targetRole === "MARKETING" || targetRole === "CAPTURE");
}

// ─────────── Pré-análise ───────────
export const isPreService = (a: AuthzActor) => a.role === "PRE_SERVICE";
/** Cadastrar e encaminhar: pré-atendimento e gestão. */
export const canCreatePreAnalysis = (a: AuthzActor) => isPreService(a) || hasGlobalView(a);
/** Pré-atendimento e gestão veem todas; consultora só as encaminhadas para ela. */
export function preAnalysisScope(a: AuthzActor): Prisma.PreAnalysisWhereInput {
  return isPreService(a) || hasGlobalView(a) ? {} : { consultantId: a.id };
}
export function canViewPreAnalysis(a: AuthzActor, p: { consultantId: string }) {
  return isPreService(a) || hasGlobalView(a) || p.consultantId === a.id;
}
/** Dar o resultado: a consultora encaminhada ou a gestão. */
export function canResolvePreAnalysis(a: AuthzActor, p: { consultantId: string }) {
  return hasGlobalView(a) || (a.role === "CONSULTANT" && p.consultantId === a.id);
}

// ─────────── Proposta (mesmo acesso da pré-análise) ───────────
export function proposalScope(a: AuthzActor): Prisma.ProposalWhereInput {
  return isPreService(a) || hasGlobalView(a) ? {} : { consultantId: a.id };
}
/** Andamento da proposta: a consultora encaminhada ou a gestão. */
export const canUpdateProposal = canResolvePreAnalysis;

export function assert(cond: boolean, msg?: string): asserts cond {
  if (!cond) throw forbidden(msg);
}

// ─────────── Captação ───────────
export const isCapture = (a: AuthzActor) => a.role === "CAPTURE";
