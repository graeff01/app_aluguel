/**
 * Demonstração pública do perfil Captação (sem login): os mesmos componentes das telas reais, com pedidos
 * FICTÍCIOS escritos aqui no código (nada vem do banco, nenhum cliente real aparece). A oferta "no site hoje" é a
 * real, consultada no site público da imobiliária. Sugestões deixadas na demonstração ficam para a gestão ler.
 */
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { hitRateLimit } from "@/lib/ratelimit";
import { assert, hasGlobalView, type AuthzActor } from "@/lib/authz";
import { buildDemand, type DemandInput } from "./demand";
import type { CaptureRow } from "@/components/capture-requests-view";

const DAY = 86400_000;
type P = [wants: string, areas: string[], type: string | null, bedrooms: number | null, maxReais: number | null, daysAgo: number, found?: string[]];

/** Pedidos de exemplo (perfis inventados, comuns em Canoas). */
const OPEN: P[] = [
  ["Casa com pátio para dois cachorros, perto de escola", ["Centro", "Marechal Rondon"], "Casa", 2, 2500, 18],
  ["Casa com garagem para 2 carros", ["Centro"], "Casa", 3, 3200, 9],
  ["Apartamento com elevador, mãe idosa", ["Centro"], "Apartamento", 2, 2200, 6, ["722136"]],
  ["Kitnet mobiliada perto da Ulbra", ["São José"], "Kitnet / studio", 1, 1200, 4],
  ["Casa térrea, sem escada", ["Marechal Rondon"], "Casa", 2, 2300, 3],
  ["Sobrado com 3 suítes", ["Moinhos de Vento"], "Sobrado", 3, 5000, 2],
  ["Apartamento pet friendly com sacada", ["Igara"], "Apartamento", 2, 1900, 1],
  ["Casa com piscina", ["Centro"], "Casa", 3, 4000, 0],
  ["Casa com 2 quartos e pátio fechado", ["Marechal Rondon", "Nossa Senhora das Graças"], "Casa", 2, 2400, 12],
  ["Apartamento perto da estação do trem", ["Centro", "Fátima"], "Apartamento", 1, 1600, 7],
  ["Casa para família grande, 4 quartos", ["Igara"], "Casa", 4, 4500, 21],
  ["Kitnet para estudante", ["Centro"], "Kitnet / studio", 1, 1000, 5],
];
const CLOSED: [string, number, number][] = [
  ["Alugou conosco", 40, 28],
  ["Agendou visita", 35, 30],
  ["Agendou visita", 22, 15],
  ["Captação não encontrou", 50, 20],
  ["Alugou em outro lugar", 30, 12],
];
/** Clientes em busca das consultoras (só o perfil). */
const SEARCHES: [string[], string | null, number | null, number | null][] = [
  [["Centro"], "Casa", 2, 2500],
  [["Igara"], "Apartamento", 2, 2000],
  [["Marechal Rondon"], "Casa", 2, 2200],
  [["Centro"], "Apartamento", 2, 2200],
];

export function demoDemandInput(now = new Date()): DemandInput {
  const at = (d: number) => new Date(now.getTime() - d * DAY);
  return {
    radars: [
      ...OPEN.map(([, areas, propertyType, bedrooms, max, ago]) => ({ areas, propertyType, bedrooms, maxBudgetCents: max ? max * 100 : null, status: "SEARCHING", createdAt: at(ago) })),
      ...CLOSED.map(([, created]) => ({ areas: ["Centro"], propertyType: "Casa", bedrooms: 2, maxBudgetCents: 240000, status: "CLOSED", createdAt: at(created) })),
    ],
    searches: SEARCHES.map(([areas, propertyType, bedrooms, max]) => ({ areas, propertyType, bedrooms, maxBudgetCents: max ? max * 100 : null, status: "ACTIVE" })),
    radarClosed: CLOSED.map(([closeReason, created, closed]) => ({ closeReason, createdAt: at(created), closedAt: at(closed) })),
  };
}

export const demoDemand = (days: number, now = new Date()) => buildDemand(demoDemandInput(now), days, now);

export function demoRequests(now = new Date()): CaptureRow[] {
  return OPEN.map(([wants, areas, propertyType, bedrooms, max, ago, found], i) => ({
    id: `demo-${i + 1}`,
    wants,
    areas,
    propertyType,
    bedrooms,
    maxBudgetCents: max ? max * 100 : null,
    sentToCaptureAt: new Date(now.getTime() - ago * DAY),
    foundCodes: found ?? [],
    status: found?.length ? ("FOUND" as const) : ("SEARCHING" as const),
    createdBy: { name: "Jasmin" },
    days: ago,
  })).sort((a, b) => a.sentToCaptureAt.getTime() - b.sentToCaptureAt.getTime());
}

/** Sugestão deixada na demonstração (sem login): limite por IP para evitar abuso. */
export async function submitDemoFeedback(input: { demo: string; name?: string; text: string; ip: string }) {
  const text = input.text.trim().slice(0, 2000);
  if (text.length < 5) throw new AppError("VALIDATION", "Escreva a sugestão.", { text: "Escreva pelo menos uma frase." });
  const rl = await hitRateLimit(`demo-feedback:${input.ip}`, 10, 3600);
  if (!rl.allowed) throw new AppError("RATE_LIMITED", "Muitas sugestões seguidas. Tente de novo mais tarde.");
  await db.demoFeedback.create({ data: { demo: input.demo.slice(0, 40), name: input.name?.trim().slice(0, 80) || null, text } });
}

export async function listDemoFeedback(actor: AuthzActor) {
  assert(hasGlobalView(actor));
  return db.demoFeedback.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
}
