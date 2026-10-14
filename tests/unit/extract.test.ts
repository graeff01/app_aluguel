import { describe, expect, it } from "vitest";
import { extractClientData } from "@/lib/extract";

const NOW = new Date("2026-10-13T15:00:00Z");

describe("colar mensagem do cliente", () => {
  it("mensagem rotulada", () => {
    const t = `Boa tarde!
Nome completo: Maria Titular da Silva
CPF: 529.982.247-25
Data de nascimento: 20/05/1990
Email: Maria@Exemplo.test
Telefone: (51) 99876-1234
Salário: R$ 4.500,00`;
    expect(extractClientData(t, NOW)).toEqual({ fullName: "Maria Titular da Silva", cpf: "52998224725", birthDate: "1990-05-20", email: "maria@exemplo.test", phone: "(51) 99876-1234", salary: "4.500,00" });
  });
  it("mensagem solta, sem rótulos", () => {
    const t = `João Pereira Santos
52998224725
nasc 03/11/1985
joao.p@exemplo.test
51 998761234
renda 3200`;
    expect(extractClientData(t, NOW)).toEqual({ fullName: "João Pereira Santos", cpf: "52998224725", birthDate: "1985-11-03", email: "joao.p@exemplo.test", phone: "(51) 99876-1234", salary: "3200" });
  });
  it("ignora CPF inválido e não confunde CPF com telefone", () => {
    const r = extractClientData("cpf 111.111.111-11 fone 51 3333-4444", NOW);
    expect(r.cpf).toBeUndefined();
    expect(r.phone).toBe("(51) 3333-4444");
  });
});
