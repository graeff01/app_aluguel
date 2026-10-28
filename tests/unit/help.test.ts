import { describe, expect, it } from "vitest";
import { CHANGELOG, LATEST_CHANGE, entryFor, unseenChanges } from "@/lib/changelog";
import { HELP, faqFor, topicForPath, topicsFor } from "@/lib/help-content";

describe("O que mudou", () => {
  it("cada perfil vê só o que vale para ele, uma vez", () => {
    expect(LATEST_CHANGE).toBe(CHANGELOG[0].id);
    // ids em ordem (a mais nova primeiro) e únicos
    expect([...CHANGELOG.map((e) => e.id)].sort().reverse()).toEqual(CHANGELOG.map((e) => e.id));
    expect(new Set(CHANGELOG.map((e) => e.id)).size).toBe(CHANGELOG.length);
    // nunca viu: só a mais recente (a gestão vê todas as novidades da equipe)
    expect(unseenChanges("MANAGER", null).map((e) => e.id)).toEqual([LATEST_CHANGE]);
    // já viu a última: nada
    expect(unseenChanges("MANAGER", LATEST_CHANGE)).toEqual([]);
    expect(unseenChanges("CONSULTANT", LATEST_CHANGE)).toEqual([]);
    // viu uma antiga: as mais novas que ela
    const old = CHANGELOG[CHANGELOG.length - 1].id;
    expect(unseenChanges("PRE_SERVICE", old).every((e) => e.id > old)).toBe(true);
    // filtro por perfil: marketing não vê a Agenda Google; admin vê o que é da gestão também
    const latest = CHANGELOG.find((e) => e.id === "2026-10-19")!;
    expect(entryFor("MARKETING", latest)!.changes.some((c) => c.href === "/agenda-google")).toBe(false);
    expect(entryFor("ADMIN", latest)!.changes.some((c) => c.href === "/painel")).toBe(true);
    expect(entryFor("ADMIN", latest)!.changes.some((c) => c.href === "/admin/google")).toBe(true);
    expect(entryFor("MANAGER", latest)!.changes.some((c) => c.href === "/admin/google")).toBe(false);
  });
});

describe("central de ajuda", () => {
  it("o “?” mostra o passo a passo da tela atual para o perfil", () => {
    expect(topicForPath("CONSULTANT", "/minhas")?.id).toBe("minhas");
    expect(topicForPath("CONSULTANT", "/visitas/abc123")?.id).toBe("resultado");
    expect(topicForPath("CONSULTANT", "/pre-analises/xyz")?.id).toBe("pre-consultora");
    expect(topicForPath("PRE_SERVICE", "/pre-analises/nova")?.id).toBe("pre-envio");
    expect(topicForPath("PRE_SERVICE", "/agenda-google")?.id).toBe("agenda-google");
    expect(topicForPath("PRE_SERVICE", "/agenda-do-dia/nova")?.id).toBe("agendar");
    expect(topicForPath("PRE_SERVICE", "/agenda-do-dia")?.id).toBe("visitas-lista");
    expect(topicForPath("MANAGER", "/oportunidades/1")?.id).toBe("andamento-gestao");
    expect(topicForPath("ADMIN", "/admin/google")?.id).toBe("google");
    expect(topicForPath("MANAGER", "/admin/google")).toBeNull();
    expect(topicForPath("MARKETING", "/marketing")?.id).toBe("marketing");
    expect(topicForPath("MARKETING", "/qualquer")).toBeNull();
  });
  it("todo perfil tem tópicos e dúvidas; ids únicos", () => {
    for (const r of ["CONSULTANT", "PRE_SERVICE", "MANAGER", "ADMIN", "MARKETING"]) {
      expect(topicsFor(r).length).toBeGreaterThan(0);
      expect(faqFor(r).length).toBeGreaterThan(0);
    }
    expect(new Set(HELP.map((t) => t.id)).size).toBe(HELP.length);
  });
});
