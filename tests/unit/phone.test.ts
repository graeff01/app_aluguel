import { describe, expect, it } from "vitest";
import { normalizePhone } from "@/lib/phone";
import { namesCompatible } from "@/lib/text";

describe("telefone", () => {
  it("normaliza DDD + número e preserva o valor original", () => {
    expect(normalizePhone("(51) 99876-5432")).toMatchObject({ raw: "(51) 99876-5432", normalized: "+5551998765432", valid: true });
    expect(normalizePhone("+55 51 3333-4444").normalized).toBe("+555133334444");
    expect(normalizePhone("051 99876-5432").normalized).toBe("+5551998765432");
  });
  it("não completa número sem DDD", () => {
    expect(normalizePhone("99876-5432")).toMatchObject({ valid: false, problem: "SEM_DDD", normalized: null });
    expect(normalizePhone("1234")).toMatchObject({ valid: false, problem: "INCOMPLETO" });
    expect(normalizePhone("")).toMatchObject({ valid: false, problem: "VAZIO" });
  });
  it("rejeita número com DDD inexistente", () => {
    expect(normalizePhone("(00) 99876-5432").valid).toBe(false);
  });
});

describe("compatibilidade de nomes", () => {
  it("compara primeiro nome e subconjuntos, sem acento", () => {
    expect(namesCompatible("Ana Souza", "ana")).toBe(true);
    expect(namesCompatible("José Silva", "Jose da Silva")).toBe(true);
    expect(namesCompatible("Ana Souza", "Bruno Lima")).toBe(false);
  });
});
