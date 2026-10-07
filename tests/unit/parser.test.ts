import { describe, expect, it } from "vitest";
import { assignConsultant, classifyTitle, DEFAULT_PATTERNS, parseVisitEvent } from "@/lib/parser";
import { htmlToText } from "@/server/sync/sanitize";

// Dados sintéticos — nenhum dado real.
const aliases = new Map([
  ["consultora.a@exemplo.test", "user-a"],
  ["consultora.b@exemplo.test", "user-b"],
]);

const MEET_DESCRIPTION = `Entre na reunião do Google Meet: https://meet.google.com/abc-defg-hij
Participar por telefone
(BR) +55 11 4560-9999 PIN: 123 456 789#
Mais números de telefone: https://tel.meet/abc-defg-hij?pin=123456789
-::~:~::~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~::~:~::-
Telefone: +55 11 4560-8888`;

describe("classificação (critério 4)", () => {
  it("reconhece o padrão Visita clt com tolerância a maiúsculas, espaços e acentos", () => {
    for (const t of ["Visita clt - Fulano", "VISITA CLT - Fulano", "  visita   clt-Fulano", "Visíta Clt - Fulano"]) {
      expect(classifyTitle(t, DEFAULT_PATTERNS).cls).toBe("VISIT");
    }
  });
  it("almoço, reunião e visita técnica não são visitas comerciais", () => {
    expect(classifyTitle("Almoço", DEFAULT_PATTERNS).cls).toBe("IRRELEVANT");
    expect(classifyTitle("Reunião de equipe", DEFAULT_PATTERNS).cls).toBe("IRRELEVANT");
    expect(classifyTitle("Visita técnica - vistoria apto 302", DEFAULT_PATTERNS).cls).toBe("IRRELEVANT");
    expect(classifyTitle("Dentista", DEFAULT_PATTERNS).cls).toBe("IRRELEVANT");
  });
  it("evento potencialmente de visita, mas fora do padrão, vai para revisão", () => {
    expect(classifyTitle("Visita apto centro - Beltrano", DEFAULT_PATTERNS).cls).toBe("AMBIGUOUS");
    expect(classifyTitle("Cliente Fulano cod 1234", DEFAULT_PATTERNS).cls).toBe("AMBIGUOUS");
  });
  it("aceita padrões adicionais configurados", () => {
    const cfg = { ...DEFAULT_PATTERNS, visitPrefixes: ["visita clt", "visita video"] };
    expect(classifyTitle("Visita vídeo - Fulano - cod 77", cfg)).toEqual({ cls: "VISIT", prefix: "visita video" });
  });
});

describe("extração (critérios 1 e 2)", () => {
  it("extrai nome, código após cod e telefone; preserva número isolado como referência externa", () => {
    const p = parseVisitEvent("Visita clt - Cliente Exemplo 1234567 - cod 654321 - (51) 99876-5432", null, "visita clt");
    expect(p.clientName).toBe("Cliente Exemplo");
    expect(p.propertyCode).toBe("654321");
    expect(p.externalRef).toBe("1234567");
    expect(p.phoneRaw).toBe("(51) 99876-5432");
    expect(p.phoneNormalized).toBe("+5551998765432");
    expect(p.issues).toEqual([]);
  });
  it("número de referência não vira código do imóvel", () => {
    const p = parseVisitEvent("Visita clt - Cliente Exemplo 1234567 - (51) 99876-5432", null, "visita clt");
    expect(p.propertyCode).toBeNull();
    expect(p.externalRef).toBe("1234567");
    expect(p.issues).toContain("MISSING_CODE");
  });
  it("preserva zeros à esquerda do código", () => {
    expect(parseVisitEvent("Visita clt - Fulano - cód: 00123 - 51998765432", null, "visita clt").propertyCode).toBe("00123");
  });
  it("telefone do Google Meet e PIN não viram telefone do cliente", () => {
    const desc = htmlToText(MEET_DESCRIPTION);
    const p = parseVisitEvent("Visita clt - Cliente Exemplo - cod 654321", desc, "visita clt");
    expect(p.phoneRaw).toBeNull();
    expect(p.issues).toContain("MISSING_PHONE");
    expect(desc ?? "").not.toMatch(/4560/);
  });
  it("lê campos rotulados da descrição quando ausentes no título", () => {
    const desc = htmlToText("<p>Cliente: Fulana de Tal</p><p>Telefone: (51) 3333-4444</p><p>Cód. imóvel: 0987</p>");
    const p = parseVisitEvent("Visita clt", desc, "visita clt");
    expect(p).toMatchObject({ clientName: "Fulana de Tal", propertyCode: "0987", phoneNormalized: "+555133334444" });
  });
  it("evento aceito sem prefixo conhecido ignora o rótulo inicial", () => {
    const p = parseVisitEvent("Visita apto - Fulana Souza - cod 321", null, "");
    expect(p).toMatchObject({ clientName: "Fulana Souza", propertyCode: "321" });
  });
  it("não confunde palavras iniciadas por 'cod' com o marcador", () => {
    const p = parseVisitEvent("Visita clt - Codorna Silva - cod 55", null, "visita clt");
    expect(p.clientName).toBe("Codorna Silva");
    expect(p.propertyCode).toBe("55");
  });
});

describe("dados incompletos e números inválidos (critério 3)", () => {
  it("telefone sem DDD fica inválido — nunca acrescenta dígitos", () => {
    const p = parseVisitEvent("Visita clt - Fulano - cod 10 - 99876-5432", null, "visita clt");
    expect(p.phoneRaw).toBe("99876-5432");
    expect(p.phoneNormalized).toBeNull();
    expect(p.issues).toContain("INVALID_PHONE");
  });
  it("título só com prefixo gera pendências de nome, código e telefone, sem descartar", () => {
    const p = parseVisitEvent("Visita clt", null, "visita clt");
    expect(p.issues.sort()).toEqual(["MISSING_CODE", "MISSING_NAME", "MISSING_PHONE"]);
  });
});

describe("atribuição pela consultora convidada (critérios 1 e 3)", () => {
  it("atribui quando exatamente uma consultora está entre os convidados", () => {
    const r = assignConsultant(
      [
        { email: "organizadora@exemplo.test", organizer: true },
        { email: "Consultora.A@Exemplo.test" },
        { email: "gestora@exemplo.test" },
      ],
      false,
      aliases,
    );
    expect(r).toEqual({ status: "AUTO", consultantId: "user-a", note: null });
  });
  it("nenhuma, duas ou lista inacessível → revisão", () => {
    expect(assignConsultant([{ email: "gestora@exemplo.test" }], false, aliases).note).toBe("NENHUMA_CONSULTORA");
    expect(assignConsultant([{ email: "consultora.a@exemplo.test" }, { email: "consultora.b@exemplo.test" }], false, aliases).note).toBe("MAIS_DE_UMA");
    expect(assignConsultant([], true, aliases).note).toBe("CONVIDADOS_INACESSIVEIS");
  });
  it("organizadora não é considerada convidada mesmo que tenha alias", () => {
    expect(assignConsultant([{ email: "consultora.a@exemplo.test", organizer: true }], false, aliases).status).toBe("NEEDS_REVIEW");
  });
});
