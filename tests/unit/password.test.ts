import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/password";

describe("senha", () => {
  it("confere a senha certa e recusa a errada", async () => {
    const h = await hashPassword("senha-correta-123");
    expect(await verifyPassword(h, "senha-correta-123")).toBe(true);
    expect(await verifyPassword(h, "outra-senha-123")).toBe(false);
  });
  it("sem senha guardada (convite pendente ou só Google) SEMPRE recusa — inclusive a frase de tempo constante", async () => {
    expect(await verifyPassword(null, "senha-ficticia-para-tempo-constante")).toBe(false);
    expect(await verifyPassword(undefined, "qualquer")).toBe(false);
    expect(await verifyPassword("", "senha-ficticia-para-tempo-constante")).toBe(false);
  });
});
