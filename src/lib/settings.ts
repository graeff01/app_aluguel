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

export const DEFAULT_CANCEL_REASONS = ["Cliente desistiu", "Cliente não confirmou", "Imóvel já alugado", "Imóvel indisponível para visita", "Pré-análise reprovada", "Outro"];
export const DEFAULT_GUARANTEES = ["Fiador", "Seguro fiança", "CredPago", "Aluga Rápido", "CredAluga", "Título de Capitalização"];
export const DEFAULT_PRE_MISSING = ["Documento com foto (RG ou CNH)", "Comprovante de renda", "Comprovante de residência", "Extrato bancário", "Declaração de imposto de renda", "Certidão de casamento ou união estável", "Dados do fiador", "Outro"];
export const DEFAULT_LEASE_HIGHLIGHTS = ["Alugado na 1ª visita", "Alugado em até 7 dias da 1ª visita", "Cliente indicado", "Imóvel estava parado há muito tempo", "Outro"];

/** Garante dados de referência (idempotente). Usado pela criação do admin e pelo seed de desenvolvimento. */
export async function ensureReferenceData(tx: Tx | typeof db = db) {
  await getSettings(tx);
  // cada lista recebe os itens padrão só enquanto estiver vazia
  const defaults = {
    VISIT_NEGATIVE: DEFAULT_NEGATIVE_REASONS,
    OPPORTUNITY_LOST: DEFAULT_LOST_REASONS,
    VISIT_CANCEL: DEFAULT_CANCEL_REASONS,
    GUARANTEE: DEFAULT_GUARANTEES,
    LEASE_HIGHLIGHT: DEFAULT_LEASE_HIGHLIGHTS,
    PRE_MISSING: DEFAULT_PRE_MISSING,
  } as const;
  for (const [kind, labels] of Object.entries(defaults) as [keyof typeof defaults, readonly string[]][]) {
    if ((await tx.reason.count({ where: { kind } })) === 0) {
      await tx.reason.createMany({ data: labels.map((label, i) => ({ kind, label, sortOrder: i })), skipDuplicates: true });
    }
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
