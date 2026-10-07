import { db, type Tx } from "./db";
import { dayKey } from "./time";
import { DEFAULT_PATTERNS, type PatternConfig } from "./parser";

/** Configuração singleton; criada com padrões na primeira leitura. */
export async function getSettings(tx: Tx | typeof db = db) {
  const s = await tx.appSettings.findUnique({ where: { id: 1 } });
  if (s) return s;
  return tx.appSettings.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, resultsStartDate: new Date(dayKey(new Date()) + "T00:00:00Z") },
  });
}

export async function getPatternConfig(tx: Tx | typeof db = db): Promise<PatternConfig> {
  const rows = await tx.eventPattern.findMany({ where: { active: true } });
  if (rows.length === 0) return DEFAULT_PATTERNS;
  return {
    visitPrefixes: rows.filter((r) => r.kind === "VISIT_PREFIX").map((r) => r.pattern),
    excludeTerms: rows.filter((r) => r.kind === "EXCLUDE").map((r) => r.pattern),
    ambiguousTerms: rows.filter((r) => r.kind === "AMBIGUOUS").map((r) => r.pattern),
  };
}

export const DEFAULT_NEGATIVE_REASONS = [
  "Preço/custo total",
  "Localização",
  "Tamanho/distribuição",
  "Conservação",
  "Características do imóvel",
  "Condições/garantia",
  "Escolheu outro imóvel",
  "Outro",
];

export const DEFAULT_LOST_REASONS = [
  "Desistiu da locação",
  "Reprovado na análise",
  "Não apresentou documentação",
  "Escolheu outro imóvel",
  "Imóvel locado para outro cliente",
  "Outro",
];

/** Garante dados de referência (idempotente). Usado pela criação do admin e pelo seed de desenvolvimento. */
export async function ensureReferenceData(tx: Tx | typeof db = db) {
  await getSettings(tx);
  const reasonCount = await tx.reason.count();
  if (reasonCount === 0) {
    await tx.reason.createMany({
      data: [
        ...DEFAULT_NEGATIVE_REASONS.map((label, i) => ({ kind: "VISIT_NEGATIVE" as const, label, sortOrder: i })),
        ...DEFAULT_LOST_REASONS.map((label, i) => ({ kind: "OPPORTUNITY_LOST" as const, label, sortOrder: i })),
      ],
    });
  }
  const patternCount = await tx.eventPattern.count();
  if (patternCount === 0) {
    await tx.eventPattern.createMany({
      data: [
        ...DEFAULT_PATTERNS.visitPrefixes.map((pattern) => ({ kind: "VISIT_PREFIX" as const, pattern })),
        ...DEFAULT_PATTERNS.excludeTerms.map((pattern) => ({ kind: "EXCLUDE" as const, pattern })),
        ...DEFAULT_PATTERNS.ambiguousTerms.map((pattern) => ({ kind: "AMBIGUOUS" as const, pattern })),
      ],
    });
  }
}
