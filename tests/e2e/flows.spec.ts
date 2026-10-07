import { expect, test, type Page } from "@playwright/test";

const PW = "senha-e2e-segura-1";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(PW);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL(/\/(hoje|painel)/);
}

test.describe.configure({ mode: "serial" });

test("consultora registra resultado no celular (fluxo principal)", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile");
  await login(page, "a@e2e.test");
  await expect(page.getByRole("heading", { name: /^Bo(m|a) (dia|tarde|noite)/ })).toBeVisible();
  // pendência de dia anterior com destaque discreto
  await expect(page.getByText(/anterior(es)? aguardando resultado/)).toBeVisible();
  await page.getByRole("link", { name: "Pendências" }).first().click();
  await expect(page.getByText("Cliente Alfa")).toBeVisible();
  await expect(page.getByText("Cliente Da B")).toHaveCount(0); // não vê visitas de outra consultora

  const card = page.locator("li", { hasText: "Cliente Alfa" });
  await card.getByRole("link", { name: "Registrar resultado" }).click();
  const save = page.getByRole("button", { name: "Salvar resultado" });
  await expect(save).toBeDisabled();
  await page.getByText("Sim, aconteceu").click();
  await page.getByText("Negativa", { exact: true }).click();
  await page.getByText("Localização").click();
  await page.getByLabel(/Observação/).fill("   ");
  await expect(save).toBeDisabled(); // só espaços não vale
  await page.getByLabel(/Observação/).fill("Achou longe do trabalho.");
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.getByText("Resultado salvo no servidor.")).toBeVisible();
  await expect(page.getByText("Realizada · Negativa").first()).toBeVisible();
  await expect(page.getByText("Achou longe do trabalho.").first()).toBeVisible();
});

test("sem conexão: não diz salvo e mantém o texto; ao voltar, salva", async ({ page, context }, info) => {
  test.skip(info.project.name !== "mobile");
  await login(page, "a@e2e.test");
  await page.goto("/pendencias");
  await page.locator("li", { hasText: "Cliente Offline" }).getByRole("link", { name: "Registrar resultado" }).click();
  await page.getByText("Cliente não compareceu").click();
  await page.getByLabel(/Observação/).fill("Liguei duas vezes, sem resposta.");
  await context.setOffline(true);
  await expect(page.getByText(/Você está sem conexão/)).toBeVisible();
  await page.getByRole("button", { name: "Salvar resultado" }).click();
  await expect(page.getByText("Não salvo")).toBeVisible();
  await expect(page.getByLabel(/Observação/)).toHaveValue("Liguei duas vezes, sem resposta.");
  await expect(page.getByText("Resultado salvo")).toHaveCount(0);
  await context.setOffline(false);
  await page.getByRole("button", { name: "Tentar novamente" }).click();
  await expect(page.getByText("Resultado salvo no servidor.")).toBeVisible();
});

test("consultora não acessa visita alheia por URL nem por API", async ({ page, request }, info) => {
  test.skip(info.project.name !== "mobile");
  await login(page, "b@e2e.test");
  await page.goto("/historico?q=Alfa");
  await expect(page.getByText("Nenhuma visita encontrada")).toBeVisible();
  // descobre o id da visita da B e tenta com a A
  await page.goto("/historico");
  const href = await page.locator("a", { hasText: "Cliente Da B" }).first().getAttribute("href");
  await page.getByLabel("Menu da conta").click();
  await page.getByRole("button", { name: "Sair" }).click();
  await page.waitForURL(/login/);
  await login(page, "a@e2e.test");
  await page.goto(href!);
  await expect(page.getByRole("heading", { name: "Registro não encontrado" })).toBeVisible();
  const res = await page.evaluate(async (url) => {
    const r = await fetch(`/api/visits/${url.split("/").pop()}/outcome`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-requested-with": "visitas" },
      body: JSON.stringify({ requestId: "hack-1234567", expectedVersion: 1, status: "NO_SHOW", note: "x" }),
    });
    return r.status;
  }, href!);
  expect(res).toBe(404);
  // sem cabeçalho/origem → bloqueado (CSRF)
  const csrf = await request.post(`/api/visits/x/outcome`, { data: {} });
  expect(csrf.status()).toBe(403);
});

test("gestora usa o painel no desktop", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop");
  await login(page, "gestora@e2e.test");
  await expect(page.getByRole("heading", { name: "Painel da equipe" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Principal" }).first()).toBeVisible();
  await expect(page.getByText("Taxa de positivas", { exact: true })).toBeVisible();
  await expect(page.getByText("Conversão da coorte", { exact: true })).toBeVisible();
  await expect(page.getByRole("table")).toBeVisible(); // por imóvel (desktop)
  // visão individual por consultora, comparada com a equipe
  await page.getByRole("link", { name: /Consultora A/ }).first().click();
  await expect(page.getByRole("heading", { name: "Consultora A" })).toBeVisible();
  await expect(page.getByText(/vs equipe/).first()).toBeVisible(); // tabela só no desktop/gestão
  await page.getByRole("link", { name: /Revisão/ }).first().click();
  await expect(page.getByRole("link", { name: "Motivos" })).toHaveCount(0); // só admin
  await expect(page.getByRole("heading", { name: "Revisão" })).toBeVisible();
});

test("PWA: manifest, ícones locais, service worker e página offline", async ({ page, request }, info) => {
  test.skip(info.project.name !== "desktop");
  const m = await (await request.get("/manifest.webmanifest")).json();
  expect(m.display).toBe("standalone");
  expect(m.lang).toBe("pt-BR");
  for (const icon of m.icons) expect((await request.get(icon.src)).status()).toBe(200);
  expect((await request.get("/offline.html")).status()).toBe(200);
  const sw = await request.get("/sw.js");
  expect(await sw.text()).toContain('startsWith("/api/")');
  await page.goto("/login");
  const registered = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    return !!reg.active;
  });
  expect(registered).toBe(true);
});

test("senha provisória: troca obrigatória no primeiro acesso", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop");
  await page.goto("/login");
  await page.getByLabel("E-mail").fill("nova@e2e.test");
  await page.getByLabel("Senha").fill("provisoria-123");
  await page.getByRole("button", { name: "Entrar" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Crie sua senha.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Painel da equipe" })).toHaveCount(0); // app bloqueado
  await dialog.getByLabel("Nova senha", { exact: true }).fill("provisoria-123");
  await dialog.getByLabel("Confirme a nova senha").fill("provisoria-123");
  await dialog.getByRole("button", { name: "Salvar e continuar" }).click();
  await expect(dialog.getByText("Escolha uma senha diferente da provisória.")).toBeVisible();
  await dialog.getByLabel("Nova senha", { exact: true }).fill("minha-senha-nova-42");
  await dialog.getByLabel("Confirme a nova senha").fill("minha-senha-nova-42");
  await dialog.getByRole("button", { name: "Salvar e continuar" }).click();
  await expect(page.getByRole("heading", { name: "Painel da equipe" })).toBeVisible();
  // a provisória deixou de valer
  await page.getByLabel("Menu da conta").click();
  await page.getByRole("button", { name: "Sair" }).click();
  await page.getByLabel("E-mail").fill("nova@e2e.test");
  await page.getByLabel("Senha").fill("provisoria-123");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByText("E-mail ou senha incorretos.")).toBeVisible();
});
