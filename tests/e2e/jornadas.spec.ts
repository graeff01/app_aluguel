/**
 * Jornadas diárias por perfil (o dia de cada pessoa, do login ao fim) + matriz de acesso.
 * Um monitor registra erro de JavaScript, de console, de rede (5xx / falha) e o tempo de cada tela;
 * qualquer erro reprova a jornada. As medições ficam em test-results/jornadas-metricas.json.
 */
import { devices, expect, test, type Browser, type Page } from "@playwright/test";
import fs from "node:fs";
const PW = "senha-e2e-segura-1"; // mesma senha do seed (não importar o seed: ele grava no banco ao carregar)

type Finding = { journey: string; kind: string; detail: string };
type Timing = { journey: string; path: string; ms: number };
const findings: Finding[] = [];
const timings: Timing[] = [];

function monitor(page: Page, journey: string) {
  page.on("pageerror", (e) => findings.push({ journey, kind: "erro de JavaScript", detail: e.message.slice(0, 200) }));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (/favicon|Failed to load resource: the server responded with a status of (401|404)/.test(t)) return; // 401/404 esperados nos testes de acesso
    findings.push({ journey, kind: /Content Security Policy|Report Only/i.test(t) ? "CSP" : "console", detail: t.slice(0, 200) });
  });
  page.on("response", (r) => {
    if (r.status() >= 500) findings.push({ journey, kind: `HTTP ${r.status()}`, detail: new URL(r.url()).pathname });
  });
  page.on("requestfailed", (r) => {
    const err = r.failure()?.errorText ?? "";
    if (/ERR_ABORTED|NS_BINDING_ABORTED/.test(err)) return; // navegação cancelada pelo próprio teste
    findings.push({ journey, kind: "requisição falhou", detail: `${new URL(r.url()).pathname} ${err}` });
  });
}

async function go(page: Page, journey: string, path: string) {
  const t0 = Date.now();
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  timings.push({ journey, path, ms: Date.now() - t0 });
  await expect(page.getByText("Não foi possível carregar esta tela"), path).toHaveCount(0);
}

async function login(page: Page, email: string, expectUrl: RegExp) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(PW);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL(expectUrl);
}

const clean = (journey: string) => findings.filter((f) => f.journey === journey);
/** celular de verdade (Pixel 7) dentro do mesmo projeto, para manter a ordem do dia entre as jornadas */
async function phone(browser: Browser, permissions: string[] = []) {
  const { defaultBrowserType: _ignored, ...pixel } = devices["Pixel 7"];
  const ctx = await browser.newContext({ ...pixel, locale: "pt-BR", timezoneId: "America/Sao_Paulo", baseURL: "http://localhost:3200", permissions });
  return { ctx, page: await ctx.newPage() };
}
/** em falha numa tela de celular aberta à mão: guarda o rastro e mostra onde parou */
async function closePhone(ctx: Awaited<ReturnType<typeof phone>>["ctx"], page: Page, failed: boolean, name: string) {
  if (failed) {
    console.log(`[${name}] parou em ${page.url()}\n` + (await page.locator("main").innerText().catch(() => "")).slice(0, 800));
  }
  await ctx.close();
}

test.describe.configure({ mode: "serial" });

test.afterAll(() => {
  fs.mkdirSync("test-results", { recursive: true });
  fs.writeFileSync("test-results/jornadas-metricas.json", JSON.stringify({ findings, timings }, null, 2));
});

// ─────────────── 1. Jasmin (pré-atendimento), computador ───────────────
test("jornada Jasmin: pré-análise com documentos, agenda da semana e cancelar um imóvel de três", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop");
  const J = "Jasmin";
  monitor(page, J);
  await login(page, "jasmin@e2e.test", /\/pre-analises/);
  await go(page, J, "/pre-analises/nova");
  await page.getByLabel("Nome completo").fill("Rafaela Jornada da Silva");
  await page.getByLabel("Telefone").fill("51 9348-4750"); // celular antigo, sem o 9
  await page.locator("label", { hasText: "Seguro fiança" }).click();
  await page.locator("label", { hasText: "Consultora A" }).first().click();
  await page.locator("#files-input").setInputFiles([
    { name: "rg-rafaela.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n% rg\n") },
    { name: "renda-rafaela.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n% renda\n") },
  ]);
  await expect(page.getByText("renda-rafaela.pdf")).toBeVisible();
  const t0 = Date.now();
  await page.getByRole("button", { name: "Enviar para a consultora" }).click();
  await expect(page.getByText("✓ Enviada para Consultora A")).toBeVisible();
  timings.push({ journey: J, path: "envio da pré-análise com 2 documentos", ms: Date.now() - t0 });
  await expect(page.getByText("Seguro fiança")).toBeVisible();
  await expect(page.getByRole("link", { name: /rg-rafaela\.pdf/ })).toBeVisible();
  await expect(page.getByText("(51) 99348-4750")).toBeVisible(); // ganhou o 9

  // agenda: semana e mês abrem; amanhã tem a visita com 3 imóveis
  await go(page, J, "/agenda-do-dia?vista=semana");
  await expect(page.getByRole("heading", { name: /^Semana de/ })).toBeVisible();
  await go(page, J, "/agenda-do-dia?vista=mes");
  const tomorrow = new Date(Date.now() + 86400_000).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  await go(page, J, `/agenda-do-dia?dia=${tomorrow}`);
  const row = (code: string) => page.locator("li", { hasText: code }).filter({ hasText: "Cliente Multi" });
  await row("00702").getByRole("button", { name: "Cancelar" }).click();
  await expect(row("00702").getByText(/Só o imóvel/)).toBeVisible();
  await row("00702").getByLabel("Motivo do cancelamento").selectOption({ label: "Cliente desistiu" });
  await row("00702").getByRole("button", { name: "Cancelar visita" }).click();
  await expect(row("00702")).toContainText("Cliente desistiu");
  // clique errado? "Desfazer" volta a visita
  await page.getByRole("button", { name: /^Desfazer \(\d+\)$/ }).click();
  await expect(page.getByText(/Cancelamento desfeito/)).toBeVisible();
  await expect(row("00702")).toContainText("Agendada");
  // agora cancela de verdade
  await row("00702").getByRole("button", { name: "Cancelar" }).click();
  await row("00702").getByLabel("Motivo do cancelamento").selectOption({ label: "Cliente desistiu" });
  await row("00702").getByRole("button", { name: "Cancelar visita" }).click();
  await expect(row("00702")).toContainText("Cliente desistiu");
  await expect(row("00701")).toContainText("Agendada");
  await expect(row("00703")).toContainText("Agendada");

  // o que ela NÃO acessa
  await page.goto("/painel");
  await expect(page).toHaveURL(/\/pre-analises/);
  expect(clean(J), JSON.stringify(clean(J), null, 1)).toEqual([]);
});

// ─────────────── 2. Consultora, celular ───────────────
test("jornada consultora (celular): responde a pré-análise, anexa documento, agenda e registra 'não veio' para os 2 imóveis", async ({ browser }, info) => {
  test.skip(info.project.name !== "desktop");
  const { ctx, page } = await phone(browser);
  const J = "Consultora A";
  monitor(page, J);
  let failed = true;
  try {
  await login(page, "a@e2e.test", /\/minhas/);
  await expect(page.getByRole("link", { name: /Pré-análises/ }).first()).toBeVisible();
  await go(page, J, "/pre-analises");
  await page.getByRole("link", { name: /Rafaela Jornada da Silva/ }).click();
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("Seguro fiança")).toBeVisible();
  // abre um documento enviado pela Jasmin
  const href = await page.getByRole("link", { name: /rg-rafaela\.pdf/ }).getAttribute("href");
  expect((await page.request.get(href!)).status()).toBe(200);
  // faltou um documento: ela mesma anexa
  await page.locator("#files-input").setInputFiles({ name: "residencia.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n% residencia\n") });
  await page.getByRole("button", { name: "Enviar documentos" }).click();
  await expect(page.getByText("Documento anexado.")).toBeVisible();
  await expect(page.getByRole("link", { name: /residencia\.pdf/ })).toBeVisible();
  // aprova e agenda a visita a partir da pré-análise
  await page.getByText("Aprovado", { exact: true }).click();
  await page.getByLabel(/Observação/).fill("Aprovado com seguro fiança.");
  await page.getByRole("button", { name: "Registrar resultado" }).click();
  await expect(page.getByText(/Resultado registrado/)).toBeVisible();
  const tomorrow = new Date(Date.now() + 2 * 86400_000).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  await page.getByLabel("Data").fill(tomorrow);
  await page.getByLabel("Horário").fill("07:30");
  await page.getByLabel("Código do imóvel").fill("00999");
  await page.getByRole("button", { name: "Agendar e preparar a agenda" }).click();
  await page.waitForURL(/\/visitas\/[^/]+\/agenda/);
  await expect(page.getByRole("link", { name: /Colocar na agenda/ })).toBeVisible();

  // visita de 2 imóveis que já passou: cliente não veio → um registro só
  await go(page, J, "/minhas");
  await page.getByRole("link", { name: /Registrar resultado: Cliente Grupo/ }).first().click();
  await page.getByText("Cliente não compareceu").click();
  await expect(page.getByText(/Vale também para o imóvel/)).toBeVisible();
  await page.getByLabel(/Observação/).fill("Não apareceu e não atende.");
  await page.getByRole("button", { name: "Salvar resultado" }).click();
  await page.waitForURL(/\/minhas|anterior=salvo/); // o app já abre a próxima pendente
  await go(page, J, "/minhas");
  await expect(page.getByRole("link", { name: /Registrar resultado: Cliente Grupo/ })).toHaveCount(0);
  await go(page, J, "/rota");
  failed = false;
  } finally {
    await closePhone(ctx, page, failed, "consultora");
  }
  expect(clean(J), JSON.stringify(clean(J), null, 1)).toEqual([]);
});

// ─────────────── 3. Gestora, computador ───────────────
test("jornada gestora: painel do pré-atendimento, cadastra agenciador e fecha a locação para o marketing", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop");
  const J = "Gestora";
  monitor(page, J);
  await login(page, "gestora@e2e.test", /\/painel/);
  for (const p of ["/painel", "/ao-vivo", "/revisao", "/oportunidades", "/relatorios", "/pre-analises", "/agenda-do-dia?vista=semana"]) await go(page, J, p);
  await go(page, J, "/pre-analises/painel");
  await expect(page.getByRole("link", { name: "Rafaela Jornada da Silva" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Seguro fiança" }).first()).toBeVisible();

  // a lista de agenciadores começa vazia: aviso em todas as telas da gestão
  await expect(page.getByRole("link", { name: "Cadastrar agenciadores" })).toBeVisible();
  await go(page, J, "/config/motivos");
  await page.getByPlaceholder("Nome do agenciador").fill("Agenciador Jornada");
  await page.getByPlaceholder("Nome do agenciador").press("Enter");
  await expect(page.getByText("Agenciador Jornada")).toBeVisible();
  await go(page, J, "/painel");
  await expect(page.getByRole("link", { name: "Cadastrar agenciadores" })).toHaveCount(0);

  // fecha a locação
  await go(page, J, "/oportunidades");
  await page.getByRole("link", { name: /Cliente Fecha/ }).first().click();
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Nova situação").selectOption({ label: "Locação fechada" });
  await page.getByLabel("Agenciador").selectOption({ label: "Agenciador Jornada" });
  await expect(page.locator("label", { hasText: "Alugado na 1ª visita" }).locator("input")).toBeChecked(); // sugerido pelo app
  await page.getByLabel(/Conte o diferencial/).fill("Fechou dois dias depois da primeira visita.");
  await page.getByRole("button", { name: "Salvar andamento" }).click();
  await expect(page.getByText("✓ Locação fechada. O marketing foi avisado para postar.")).toBeVisible();
  await go(page, J, "/marketing");
  await expect(page.getByText("Imóvel 00901")).toBeVisible();
  expect(clean(J), JSON.stringify(clean(J), null, 1)).toEqual([]);
});

// ─────────────── 4. Marketing, celular ───────────────
test("jornada marketing (celular): recebe a locação, copia o resumo e marca como postado", async ({ browser }, info) => {
  test.skip(info.project.name !== "desktop");
  const J = "Marketing";
  const { ctx, page } = await phone(browser, ["clipboard-read", "clipboard-write"]);
  monitor(page, J);
  let failed = true;
  try {
  await login(page, "mkt@e2e.test", /\/marketing/);
  const card = page.locator("li", { hasText: "Imóvel 00901" });
  await expect(card).toContainText("Agenciador Jornada");
  await expect(card).toContainText("Alugado na 1ª visita");
  await card.getByRole("button", { name: "Copiar resumo" }).click();
  await expect(card.getByRole("button", { name: "Copiado ✓" })).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain("Imóvel 00901");
  expect(copied).not.toContain("Cliente Fecha"); // marketing não recebe dado do cliente
  await card.getByRole("button", { name: "Marcar como postado" }).click();
  await expect(page.locator("li", { hasText: "Imóvel 00901" })).toHaveCount(0); // saiu de "Para postar"
  await go(page, J, "/marketing?aba=postadas");
  await expect(page.getByText("Imóvel 00901")).toBeVisible();
  await page.goto("/pre-analises");
  await expect(page).toHaveURL(/\/marketing/);
  failed = false;
  } finally {
    await closePhone(ctx, page, failed, "marketing");
  }
  expect(clean(J), JSON.stringify(clean(J), null, 1)).toEqual([]);
});

// ─────────────── 5. Matriz de acesso ───────────────
type Expect = "ok" | "404" | RegExp;
const ROUTES = ["/minhas", "/rota", "/pendencias", "/historico", "/visitas/nova", "/pre-analises", "/pre-analises/nova", "/pre-analises/painel", "/agenda-do-dia", "/marketing", "/painel", "/ao-vivo", "/revisao", "/oportunidades", "/imoveis", "/clientes", "/relatorios", "/config/usuarios", "/config/motivos", "/admin/google", "/admin/configuracoes", "/admin/sincronizacao", "/config/auditoria", "/conta/senha"];
const MATRIX: Record<string, { email: string; home: RegExp; rules: Record<string, Expect> }> = {
  consultora: {
    email: "b@e2e.test",
    home: /\/minhas/,
    rules: { "/pre-analises/nova": "404", "/pre-analises/painel": "404", "/agenda-do-dia": /\/minhas/, "/marketing": "404", "/painel": "404", "/ao-vivo": "404", "/revisao": "404", "/imoveis": "404", "/clientes": "404", "/relatorios": "404", "/config/usuarios": "404", "/config/motivos": "404", "/admin/google": "404", "/admin/configuracoes": "404", "/admin/sincronizacao": "404", "/config/auditoria": "404" },
  },
  "pré-atendimento": {
    email: "jasmin@e2e.test",
    home: /\/pre-analises/,
    rules: Object.fromEntries(ROUTES.filter((r) => !["/pre-analises", "/pre-analises/nova", "/agenda-do-dia", "/conta/senha", "/pre-analises/painel"].includes(r)).map((r) => [r, /\/pre-analises$/])),
  },
  marketing: {
    email: "mkt@e2e.test",
    home: /\/marketing/,
    rules: Object.fromEntries(ROUTES.filter((r) => !["/marketing", "/conta/senha"].includes(r)).map((r) => [r, /\/marketing$/])),
  },
  gestora: {
    email: "gestora@e2e.test",
    home: /\/painel/,
    rules: { "/admin/google": "404", "/admin/configuracoes": "404", "/admin/sincronizacao": "404", "/config/auditoria": "404" },
  },
};

for (const [role, m] of Object.entries(MATRIX)) {
  test(`acesso: ${role} só abre as telas do perfil`, async ({ page }, info) => {
    test.skip(info.project.name !== "desktop");
    test.setTimeout(150_000);
    const J = `acesso ${role}`;
    monitor(page, J);
    await login(page, m.email, m.home);
    const wrong: string[] = [];
    for (const path of ROUTES) {
      const rule = m.rules[path] ?? "ok";
      if (role === "pré-atendimento" && path === "/pre-analises/painel") continue; // abre a lista (Next trata como 404 dentro da área dela) — conferido abaixo
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const notFound = (await page.getByText("Registro não encontrado").count()) > 0 || (await page.getByText(/não encontrad/i).count()) > 0;
      const ok = rule === "ok" ? !notFound && new URL(page.url()).pathname === path.split("?")[0] : rule === "404" ? notFound : rule.test(new URL(page.url()).pathname);
      if (!ok) wrong.push(`${path} → esperado ${rule}, ficou ${new URL(page.url()).pathname}${notFound ? " (não encontrado)" : ""}`);
    }
    expect(wrong, wrong.join("\n")).toEqual([]);
    expect(clean(J).filter((f) => !/HTTP 404/.test(f.kind)), JSON.stringify(clean(J), null, 1)).toEqual([]);
  });
}
