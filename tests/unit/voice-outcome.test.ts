// Registro por voz: o que a consultora fala vira o preenchimento sugerido (regras fixas, sem IA).
import { describe, expect, it } from "vitest";
import { followUpFrom, interpretSpeech, tidySentence } from "@/lib/voice-outcome";
import { DEFAULT_NEGATIVE_REASONS } from "@/lib/settings";

const reasons = DEFAULT_NEGATIVE_REASONS.map((label, i) => ({ id: `r${i}`, label }));
const id = (label: string) => reasons.find((r) => r.label === label)!.id;
const TUESDAY = 2;

describe("interpretSpeech", () => {
  it("gostou mas vai conversar → ainda decidindo, com retorno no dia falado", () => {
    const r = interpretSpeech("cliente gostou mas achou o condomínio alto, vai conversar com o marido e me dá retorno na sexta", reasons, TUESDAY);
    expect(r).toMatchObject({ status: "DONE", evaluation: "UNDECIDED", followUpDays: 3, followUpLabel: "sexta-feira", reasonId: null });
    expect(r.note).toBe("Cliente gostou mas achou o condomínio alto, vai conversar com o marido e me dá retorno na sexta.");
  });

  it("não gostou (contém 'gostou') → negativa com motivo", () => {
    expect(interpretSpeech("não gostou, achou caro demais pro orçamento", reasons, TUESDAY)).toMatchObject({ status: "DONE", evaluation: "NEGATIVE", reasonId: id("Preço/custo total") });
    expect(interpretSpeech("achou muito longe do trabalho", reasons, TUESDAY)).toMatchObject({ evaluation: "NEGATIVE", reasonId: id("Localização") });
    expect(interpretSpeech("não quis, apartamento pequeno demais", reasons, TUESDAY)).toMatchObject({ evaluation: "NEGATIVE", reasonId: id("Tamanho/distribuição") });
    expect(interpretSpeech("desistiu, já alugou outro imóvel", reasons, TUESDAY)).toMatchObject({ evaluation: "NEGATIVE", reasonId: id("Escolheu outro imóvel") });
    expect(interpretSpeech("não quer porque não tem fiador", reasons, TUESDAY)).toMatchObject({ evaluation: "NEGATIVE", reasonId: id("Condições/garantia") });
  });

  it("não gostou, mas continua procurando → marca a busca", () => {
    expect(interpretSpeech("não gostou da planta, mas continua procurando, quer ver outras opções", reasons, TUESDAY)).toMatchObject({ evaluation: "NEGATIVE", stillSearching: true });
    expect(interpretSpeech("não gostou, achou caro", reasons, TUESDAY)).toMatchObject({ evaluation: "NEGATIVE", stillSearching: false });
  });

  it("quer fechar / vai mandar documentação → positiva", () => {
    expect(interpretSpeech("adorou, quer fechar e vai mandar a documentação hoje", reasons, TUESDAY)).toMatchObject({ status: "DONE", evaluation: "POSITIVE" });
    expect(interpretSpeech("gostou muito do apartamento", reasons, TUESDAY)).toMatchObject({ status: "DONE", evaluation: "POSITIVE" });
  });

  it("não veio, cancelou e remarcou", () => {
    expect(interpretSpeech("cliente não apareceu e não atendeu", reasons, TUESDAY)).toMatchObject({ status: "NO_SHOW", evaluation: null });
    expect(interpretSpeech("ela cancelou em cima da hora", reasons, TUESDAY)).toMatchObject({ status: "CANCELED" });
    expect(interpretSpeech("pediu para remarcar para semana que vem", reasons, TUESDAY)).toMatchObject({ status: "RESCHEDULED" });
  });

  it("texto sem pistas não inventa nada", () => {
    expect(interpretSpeech("apartamento no terceiro andar", reasons, TUESDAY)).toMatchObject({ status: null, evaluation: null, reasonId: null });
    expect(interpretSpeech("   ", reasons, TUESDAY)).toMatchObject({ status: null, note: "" });
  });
});

describe("followUpFrom", () => {
  it("dias relativos e dias da semana (a partir de terça)", () => {
    expect(followUpFrom("amanha", TUESDAY)).toEqual({ days: 1, label: "amanhã" });
    expect(followUpFrom("depois de amanha", TUESDAY)).toEqual({ days: 2, label: "depois de amanhã" });
    expect(followUpFrom("em 5 dias", TUESDAY)).toEqual({ days: 5, label: "em 5 dias" });
    expect(followUpFrom("daqui a dois dias", TUESDAY)).toEqual({ days: 2, label: "em 2 dias" });
    expect(followUpFrom("semana que vem", TUESDAY)).toEqual({ days: 7, label: "semana que vem" });
    expect(followUpFrom("na segunda", TUESDAY)).toEqual({ days: 6, label: "segunda-feira" });
    expect(followUpFrom("na terca", TUESDAY)).toEqual({ days: 7, label: "terça-feira" });
    expect(followUpFrom("no fim de semana", TUESDAY)).toEqual({ days: 4, label: "fim de semana" });
    expect(followUpFrom("sem data", TUESDAY)).toBeNull();
  });
});

it("tidySentence", () => {
  expect(tidySentence("  gostou  da cozinha ")).toBe("Gostou da cozinha.");
  expect(tidySentence("Vai pensar!")).toBe("Vai pensar!");
});
