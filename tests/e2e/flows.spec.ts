import { expect, test, type Page } from "@playwright/test";

const PW = "senha-e2e-segura-1";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(PW);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL(/\/(minhas|painel)/);
}

test.describe.configure({ mode: "serial" });

test("consultora registra resultado no celular (tela única)", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile");
  await login(page, "a@e2e.test");
  await expect(page.getByRole("heading", { name: /^Bo(m|a) (dia|tarde|noite)/ })).toBeVisible();
  await expect(page.getByText(/visitas? esperando o seu registro/)).toBeVisible();
  // tela única: sem menus de navegação nem acesso a outras telas
  await expect(page.getByRole("navigation", { name: "Principal" })).toHaveCount(0);
  await page.goto("/historico");
  await expect(page).toHaveURL(/\/minhas/);
  await expect(page.getByText("Cliente Alfa")).toBeVisible();
  await expect(page.getByText("Cliente Da B")).toHaveCount(0); // não vê visitas de outra consultora

  const card = page.locator("li", { hasText: "Cliente Alfa" });
  // ligar / WhatsApp apenas abrem o contato
  await expect(card.getByRole("link", { name: "Ligar para Cliente Alfa" })).toHaveAttribute("href", "tel:+5551998760001");
  await expect(card.getByRole("link", { name: "Abrir WhatsApp para Cliente Alfa" })).toHaveAttribute("href", "https://wa.me/5551998760001");
  await card.getByRole("link", { name: /^Registrar resultado/ }).first().click();
  const save = page.getByRole("button", { name: "Salvar resultado" });
  await expect(save).toBeDisabled();
  await page.getByText("Sim, aconteceu").click();
  await page.getByText("Negativa", { exact: true }).click();
  await page.getByText("Localização", { exact: true }).click();
  await page.getByLabel(/Observação/).fill("   ");
  await expect(save).toBeDisabled(); // só espaços não vale
  await page.getByLabel(/Observação/).fill("Achou longe do trabalho.");
  await expect(save).toBeEnabled();
  await save.click();
  // encadeia para a próxima pendente (a mais antiga)
  await expect(page.getByText("Resultado anterior salvo.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Registrar resultado" })).toBeVisible();
  await expect(page.getByText("Cliente Beta").first()).toBeVisible();
  await page.getByRole("link", { name: "← Minhas visitas" }).click();
  await page.getByText(/Registradas nos últimos 7 dias/).click();
  const done = page.locator("li", { hasText: "Cliente Alfa" });
  await expect(done.getByText("Negativa")).toBeVisible();
  await expect(done.getByText("Achou longe do trabalho.")).toBeVisible();
});

test("sem conexão: não diz salvo e mantém o texto; ao voltar, salva", async ({ page, context }, info) => {
  test.skip(info.project.name !== "mobile");
  await login(page, "a@e2e.test");
  await page.goto("/minhas");
  await page.locator("li", { hasText: "Cliente Offline" }).getByRole("link", { name: /^Registrar resultado/ }).first().click();
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
  await expect(page.getByText("Resultado anterior salvo.")).toBeVisible(); // salvou e seguiu para a próxima pendente
});

test("consultora não acessa visita alheia por URL nem por API", async ({ page, request }, info) => {
  test.skip(info.project.name !== "mobile");
  await login(page, "b@e2e.test");
  await expect(page.getByText("Cliente Alfa")).toHaveCount(0);
  const regHref = await page.locator("li", { hasText: "Cliente Da B" }).getByRole("link", { name: /^Registrar resultado/ }).first().getAttribute("href");
  const href = regHref!.replace(/\/registrar$/, "");
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
  // consultora não exporta CSV
  expect((await page.request.get("/api/export/visitas")).status()).toBe(403);
});

test("gestora usa o painel no desktop", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop");
  await login(page, "gestora@e2e.test");
  await expect(page.getByRole("heading", { name: "Painel da equipe" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Principal" }).first()).toBeVisible();
  await expect(page.getByText("Taxa de positivas", { exact: true })).toBeVisible();
  await expect(page.getByText("Conversão da coorte", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Evolução semanal" })).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(2); // evolução semanal + por imóvel
  // exportação CSV (gestão)
  const res = await page.request.get("/api/export/visitas");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("text/csv");
  const csv = await res.text();
  expect(csv.split("\r\n")[0]).toContain("Data;Início;Fim;Consultora;Cliente");
  expect(csv).toContain("Cliente Alfa");
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

test("desfazer em 5 segundos após salvar e respostas rápidas", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile");
  await login(page, "b@e2e.test");
  await page.locator("li", { hasText: "Cliente Da B" }).getByRole("link", { name: /^Registrar resultado/ }).first().click();
  await page.getByText("Cliente não compareceu").click();
  await page.getByRole("button", { name: "+ Não compareceu e não atendeu o telefone." }).click();
  await expect(page.getByLabel(/Observação/)).toHaveValue(/Não compareceu e não atendeu o telefone\./);
  await page.getByRole("button", { name: "Salvar resultado" }).click();
  await expect(page).toHaveURL(/\/minhas/);
  await page.getByRole("button", { name: /^Desfazer/ }).click();
  await expect(page.getByText("Registro desfeito. A visita voltou a aguardar resultado.")).toBeVisible();
  await page.goto("/minhas");
  await expect(page.locator("li", { hasText: "Cliente Da B" }).getByRole("link", { name: /^Registrar resultado/ }).first()).toBeVisible();
});

test("modo escuro segue o aparelho", async ({ browser }, info) => {
  test.skip(info.project.name !== "desktop");
  const ctx = await browser.newContext({ colorScheme: "dark" });
  const page = await ctx.newPage();
  await page.goto("/login");
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe("rgb(18, 20, 22)");
  await ctx.close();
});

test("gestora: funil, imóveis, quadro de andamento e abas da visita", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop");
  await login(page, "gestora@e2e.test");
  await expect(page.getByRole("heading", { name: "Funil de locação" })).toBeVisible();
  await page.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: "Imóveis" }).click();
  await page.getByRole("link", { name: /00444/ }).first().click();
  await expect(page.getByRole("heading", { name: "00444" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Por que não avançou" })).toBeVisible();
  // quadro: mover de acompanhamento para documentação
  await page.goto("/oportunidades?vista=quadro");
  const follow = page.getByRole("region", { name: "Em acompanhamento" });
  await expect(follow.getByText("Cliente Kanban", { exact: true })).toBeVisible();
  await follow.getByLabel("Mover Cliente Kanban para").selectOption("DOCS_REVIEW");
  await expect(page.getByRole("region", { name: "Documentação em análise" }).getByText("Cliente Kanban", { exact: true })).toBeVisible();
  // abas no detalhe da visita
  await page.goto("/imoveis/00444");
  await page.locator('a[href^="/visitas/"]', { hasText: "Cliente Kanban" }).first().click();
  await page.getByRole("tab", { name: /Histórico/ }).click();
  await expect(page.getByRole("tabpanel").getByText("Gostou e vai trazer a família.")).toBeVisible();
});

test("consultora busca visita antiga e acessa alterar senha", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile");
  await login(page, "a@e2e.test");
  await page.getByLabel("Buscar visita por nome, telefone ou código").fill("Beta");
  await page.keyboard.press("Enter");
  await expect(page.getByText(/resultados? para “Beta”/)).toBeVisible();
  await expect(page.getByText("Cliente Beta")).toBeVisible();
  await page.getByLabel("Menu da conta").click();
  await page.getByRole("link", { name: "Alterar senha" }).click();
  await expect(page.getByRole("heading", { name: "Alterar senha" })).toBeVisible();
});

test("visita futura: resultado travado até o horário, cancelar liberado", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile");
  await login(page, "a@e2e.test");
  const card = page.locator("li", { hasText: "Cliente Futuro" });
  const locked = card.getByRole("link", { name: /Resultado a partir das/ });
  await expect(locked).toBeVisible();
  await locked.click();
  await expect(page.getByRole("heading", { name: "Registrar resultado" })).toBeVisible();
  await expect(page.getByRole("radio", { name: /Sim, aconteceu/ })).toBeDisabled();
  await expect(page.getByRole("radio", { name: /Cliente não compareceu/ })).toBeDisabled();
  await expect(page.getByText(/Disponível a partir das/).first()).toBeVisible();
  await page.getByText("Cancelada", { exact: true }).click();
  await page.getByRole("button", { name: "+ Cliente cancelou a visita." }).click();
  await page.getByRole("button", { name: "Salvar resultado" }).click();
  // espera a confirmação do servidor antes de sair da tela
  await expect(page.getByText(/Resultado (anterior )?salvo/).first()).toBeVisible();
  await page.goto("/minhas");
  await page.getByText(/Registradas nos últimos 7 dias/).click();
  await expect(page.locator("li", { hasText: "Cliente Futuro" }).getByText("Cancelada")).toBeVisible();
});

test("celular: campos com 16px (sem zoom automático do iPhone)", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile");
  await page.goto("/login");
  const size = await page.getByLabel("E-mail").evaluate((el) => getComputedStyle(el).fontSize);
  expect(size).toBe("16px");
  const viewport = await page.locator('meta[name="viewport"]').getAttribute("content");
  expect(viewport).not.toContain("user-scalable=no"); // pinça continua liberada
});

test("LGPD: aviso de privacidade no primeiro acesso", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile");
  await page.goto("/login");
  await page.getByLabel("E-mail").fill("privacidade@e2e.test");
  await page.getByLabel("Senha").fill(PW);
  await page.getByRole("button", { name: "Entrar" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/Não registre documentos/)).toBeVisible();
  await expect(page.getByText(/esperando o seu registro|Nada esperando/)).toHaveCount(0); // app bloqueado até a ciência
  await dialog.getByRole("button", { name: "Li e estou de acordo" }).click();
  await expect(page.getByText(/esperando o seu registro|Nada esperando/).first()).toBeVisible();
  await page.goto("/privacidade");
  await expect(page.getByRole("heading", { name: "Aviso de privacidade" })).toBeVisible();
});

test("gestora: relatório mensal com prévia e PDF", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop");
  await login(page, "gestora@e2e.test");
  await page.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: "Relatórios" }).click();
  await expect(page.getByRole("heading", { name: /^Visitas — / })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Destaques" })).toBeVisible();
  const href = await page.getByRole("link", { name: /Baixar PDF/ }).first().getAttribute("href");
  const res = await page.request.get(href!);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("application/pdf");
  expect((await res.body()).subarray(0, 5).toString()).toBe("%PDF-");
});

test("consultora: rota do dia abre no Maps com o endereço do imóvel", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile");
  await login(page, "c@e2e.test");
  await page.goto("/rota");
  await expect(page.getByRole("heading", { name: /^Rota de/ })).toBeVisible();
  if (!(await page.getByText("Cliente Rota").first().isVisible())) await page.getByRole("link", { name: "Amanhã" }).click();
  await expect(page.getByText("Cliente Rota").first()).toBeVisible();
  const maps = page.getByRole("link", { name: /Abrir rota no Google Maps/ });
  await expect(maps).toBeVisible();
  const href = new URL((await maps.getAttribute("href"))!);
  expect(href.searchParams.get("destination")).toBe("Rua Teste, 322, Canoas - RS");
  await expect(page.getByRole("link", { name: "Waze" }).first()).toBeVisible();
  // mapa com marcadores numerados e mini-cards
  await expect(page.getByRole("region", { name: "Mapa da rota" })).toBeVisible();
  await expect(page.locator(".rm-pin")).not.toHaveCount(0);
  await expect(page.getByText(/paradas? no mapa/)).toBeVisible();
});

test("atalho da notificação abre o registro já marcado", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile");
  await login(page, "c@e2e.test");
  const link = page.getByRole("link", { name: /Registrar resultado: Cliente Atalho/ }).first();
  const href = await link.getAttribute("href");
  await page.goto(`${href}?r=NEGATIVE`);
  await expect(page.getByRole("radio", { name: /Sim, aconteceu/ })).toBeChecked();
  await expect(page.getByRole("radio", { name: /Negativa/ })).toBeChecked();
});

test("gestora: ao vivo, termômetro e relatório do proprietário", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop");
  await login(page, "gestora@e2e.test");
  await page.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: "Ao vivo" }).click();
  await expect(page.getByRole("heading", { name: "Hoje ao vivo" })).toBeVisible();
  await expect(page.getByText("Consultora A", { exact: true })).toBeVisible();
  await expect(page.getByText(/Atualiza sozinho/)).toBeVisible();
  await page.goto("/imoveis");
  await expect(page.getByRole("heading", { name: "Termômetro" })).toBeVisible();
  await page.goto("/imoveis/00444");
  const pdf = page.getByRole("link", { name: "Relatório para o proprietário (PDF)" });
  const res = await page.request.get((await pdf.getAttribute("href"))!);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("application/pdf");
  expect((await res.body()).subarray(0, 5).toString()).toBe("%PDF-");
});
