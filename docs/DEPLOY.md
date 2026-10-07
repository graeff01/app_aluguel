# Guia de publicação — Railway + Google Agenda

Este guia leva o Visitas Locação do repositório até produção. Siga na ordem e marque o checklist ao final.

> **Estado atual:** projeto Railway `app_aluguel` (workspace VELOCE), ambiente `production`, criado por IaC a partir de `.railway/railway.ts`. Repositório `graeff01/app_aluguel`, branch `main` — **cada push na main gera deploy automático em produção** (web e worker). URL: https://web-production-3d500.up.railway.app

---

## 1. Visão geral

| Serviço Railway | Comando |
|---|---|
| **Postgres** | banco gerenciado |
| **web** | `npm run start` (escuta `0.0.0.0:$PORT`) |
| **worker** | `npm run worker` (processo persistente, sem porta) |

Infraestrutura declarada em **`.railway/railway.ts`** (Infrastructure as Code do Railway; substitui `railway.json`, descontinuado em 01/12/2026). Para alterar: edite o arquivo e rode `railway config plan` e `railway config apply`. Segredos não ficam no arquivo — são definidos com `railway variables --set` e marcados com `preserve()`.

- Build (ambos): `npm run build` → `prisma generate` + `next build` + bundle do worker em `dist/worker.mjs`.
- Pré-deploy (ambos): `npm run db:migrate` (`prisma migrate deploy`). Executa antes de a nova versão receber tráfego; se falhar, o deploy não prossegue. É idempotente e seguro em paralelo (o Prisma usa bloqueio próprio).
- Healthcheck (web): `GET /api/health` → 200 se o app e o banco respondem.
- Runtime: Node 22 (`.nvmrc` e `engines`). Nenhum arquivo persistente em disco local.

---

## 2. Google Cloud (OAuth + Calendar API)

1. Crie (ou use) um projeto em <https://console.cloud.google.com>. **Se a imobiliária usa Google Workspace**, crie o projeto dentro da organização dela.
2. **APIs e serviços → Biblioteca → Google Calendar API → Ativar.**
3. **Tela de consentimento OAuth (Google Auth Platform):**
   - Tipo de usuário:
     - **Interno** (somente se a conta da agenda central for do Workspace da imobiliária e o projeto pertencer à organização): **não exige verificação** e os tokens não expiram por modo de teste. *Recomendado quando possível.*
     - **Externo** (ex.: agenda central em conta @gmail.com):
       - Em **Teste**: adicione a conta da agenda central como *usuário de teste*. **Atenção: em modo Teste com usuário externo, o refresh token expira em 7 dias** — a integração vai parar semanalmente e exigir reconexão. Serve só para validação.
       - Em **Produção**: os escopos de Agenda são sensíveis. O Google isenta de verificação apps de uso pessoal/limitado (menos de 100 usuários) — aqui só **uma** conta autoriza (a da agenda central). Ao conectar, aparecerá o aviso “app não verificado”; a pessoa administradora pode prosseguir. Se a política da imobiliária exigir, solicite a verificação oficial (prazo de dias a semanas).
   - Nome do app: “Visitas Locação” (não use logotipo da imobiliária sem autorização).
   - **Escopos** (adicione exatamente estes):
     - `openid`, `.../auth/userinfo.email` (identificar a conta conectada)
     - `https://www.googleapis.com/auth/calendar.calendarlist.readonly` (listar calendários)
     - `https://www.googleapis.com/auth/calendar.events.readonly` (ler eventos)
4. **Credenciais → Criar credenciais → ID do cliente OAuth → Aplicativo da Web.**
   - URIs de redirecionamento autorizados:
     - Desenvolvimento: `http://localhost:3000/api/google/callback`
     - Produção: `https://SEU-DOMINIO/api/google/callback` (o mesmo valor de `APP_URL` + `/api/google/callback`)
   - Copie **Client ID** e **Client Secret** para as variáveis do Railway (nunca para o repositório).

### Permissão no calendário central

A conta conectada precisa ver **todos os detalhes** dos eventos:
- ser a dona do calendário, **ou**
- ter o calendário compartilhado com “**Ver todos os detalhes do evento**” (ou “Fazer alterações…”).

Com acesso “ver apenas livre/ocupado”, o app mostra o calendário como **sem permissão** e não permite selecioná-lo — não importa dados incompletos.

> A conta logada no navegador não prova quem é dono do calendário. O app mostra a conta conectada, o calendário selecionado e o papel de acesso retornado pela API.

---

## 3. Railway — passo a passo (para recriar do zero)

Atalho com a CLI (≥ 5.42): `railway init` → `railway config apply` (cria Postgres, web e worker) → `railway variables --service web --set TOKEN_ENCRYPTION_KEY=... --set SETUP_TOKEN=...` e o mesmo `TOKEN_ENCRYPTION_KEY` no worker → `railway domain --service web`. O passo a passo manual equivalente:

1. **Novo projeto** → *Deploy from GitHub repo* (este repositório).
2. **Adicionar Postgres:** *New → Database → PostgreSQL*.
3. **Serviço web** (o criado a partir do repo):
   - *Variables*:
     - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`
     - `APP_URL` = `https://<domínio do serviço>` (gere em *Settings → Networking → Generate Domain* ou use domínio próprio)
     - `TOKEN_ENCRYPTION_KEY` = saída de `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
     - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
     - `SETUP_TOKEN` = texto aleatório ≥ 16 caracteres (temporário, só para criar o 1º admin)
4. **Serviço worker:** *New → GitHub Repo* (mesmo repositório) → renomeie para `worker`.
   - Start command: `npm run worker`; restart policy: Always; pré-deploy: `npm run db:migrate`.
   - *Variables*: as mesmas `DATABASE_URL`, `TOKEN_ENCRYPTION_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `APP_URL` (use *Shared Variables* do projeto para não duplicar).
   - Não gere domínio público para o worker.
   - **Mantenha 1 réplica** (várias réplicas são seguras — há advisory lock —, mas desnecessárias).
5. Faça o deploy. Confirme nos logs do web: pré-deploy “All migrations have been successfully applied”; healthcheck verde. Nos logs do worker: `{"event":"worker.start"...}`.

### Primeiro administrador

Opção A (tela): acesse `https://SEU-DOMINIO/configuracao-inicial`, informe o `SETUP_TOKEN`, nome, e-mail e senha. A tela só funciona enquanto não existir nenhum usuário. **Depois remova a variável `SETUP_TOKEN`.**

Opção B (terminal): `railway run --service web npm run admin:create -- --email pessoa@dominio --name "Nome"` (pede a senha; nunca há senha padrão).

### Usuários com senha provisória

Na tela **Usuários**, preencha “Senha provisória” ao criar (ou use “Definir senha provisória” no usuário). No primeiro acesso a pessoa é obrigada a criar a própria senha; até lá o app e as APIs ficam bloqueados para ela. Pelo terminal (com acesso ao banco): `TEMP_PASSWORD=... npx tsx scripts/create-user.ts --email x@y --name "Nome" --role MANAGER`.

O Postgres de produção **não tem acesso público**. Para rodar scripts, abra um proxy TCP temporário no serviço Postgres (Railway → Settings → Networking) e remova logo após o uso.

### Configuração no app (como admin)

1. **Usuários** → crie a gestora e as consultoras. Para cada consultora, cadastre em “E-mails convidados na agenda” **exatamente** o e-mail que aparece como convidado nos eventos. O app gera um link de senha (24 h, uso único) — envie por canal seguro.
2. **Regras e app** → defina a **data de início da cobrança** (normalmente o dia da implantação), intervalo e janela.
3. **Agenda Google** → *Conectar conta Google* com a conta da agenda central → selecione o calendário central (deve aparecer “Vê todos os detalhes” ou superior).
4. **Diagnóstico** → confira a primeira execução (completa), contagens, e “Worker ativo”.
5. **Revisão** → trate atribuições e eventos ambíguos da primeira importação.
6. **Padrões de eventos** → ajuste se houver outros formatos (ex.: `visita video`).

### Reconexão e renovação do acesso

- O app renova o access token automaticamente com o refresh token (salvo criptografado) e grava a renovação.
- Se o Google recusar (`invalid_grant`: senha da conta trocada, acesso revogado, 7 dias em modo Teste externo, limite de tokens), a conexão vai para **“Reconexão necessária”**: o cabeçalho avisa, o login e os registros continuam funcionando, só a importação para.
- Para reconectar: **Agenda Google → Reconectar** com a mesma conta (o calendário selecionado é mantido).
- Como verificar se a renovação funciona: em **Diagnóstico**, a “Última sucesso” deve avançar a cada intervalo por mais de 1 hora (o access token dura ~1 h). Em modo Teste externo, confirme também após 7 dias que a conexão continua — se não, publique o app (Produção) ou use tipo Interno.
- Se o Google não devolver refresh token: remova o acesso em <https://myaccount.google.com/permissions> e conecte de novo (o app sempre solicita `prompt=consent`).

---

## 4. Variáveis de ambiente

| Variável | Serviço | Obrigatória | Descrição |
|---|---|---|---|
| `DATABASE_URL` | web, worker | sim | `${{Postgres.DATABASE_URL}}` |
| `APP_URL` | web, worker | sim | URL pública `https://…` (cookies seguros, links, OAuth) |
| `TOKEN_ENCRYPTION_KEY` | web, worker | sim | 32 bytes base64; **igual nos dois serviços** |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | web, worker | para integração | Credencial OAuth “Aplicativo da Web” |
| `GOOGLE_REDIRECT_URI` | web | não | Padrão `${APP_URL}/api/google/callback` |
| `SETUP_TOKEN` | web | só na implantação | Remova após criar o admin |
| `WORKER_TICK_MS` | worker | não | Laço do worker (padrão 15000) |
| `PORT` | web | automático | Injetado pelo Railway |

---

## 5. Checklist de implantação

- [ ] Google Calendar API ativada; tela de consentimento com os 4 escopos; tipo (Interno/Externo) decidido.
- [ ] URI de callback de produção cadastrada **idêntica** a `APP_URL/api/google/callback`.
- [ ] Postgres criado; backups habilitados (seção 6).
- [ ] Variáveis definidas nos serviços web e worker (mesma `TOKEN_ENCRYPTION_KEY`).
- [ ] Worker com start `npm run worker` (definido em `.railway/railway.ts`).
- [ ] Deploy: pré-deploy de migração OK; healthcheck OK; worker com batimento.
- [ ] Primeiro admin criado; `SETUP_TOKEN` removido.
- [ ] Gestora e consultoras criadas; e-mails da agenda vinculados; links de senha entregues.
- [ ] Data de início da cobrança configurada.
- [ ] Conta Google conectada; calendário central com acesso a detalhes; primeira sincronização com sucesso.
- [ ] Teste real: um evento “Visita clt - … - cod … - telefone” com a consultora convidada aparece em **Hoje** dela em até ~5 min; registro de resultado salvo.
- [ ] Revisão da primeira importação concluída.
- [ ] PWA instalado em um Android e um iPhone (Perfil → instruções).

### Validação real pendente (não executada nesta entrega)

Os testes automatizados usam uma **API Google simulada**. Antes de considerar a integração pronta, valide com a conta real:
1. OAuth completo em produção (HTTPS) e listagem de calendários com o papel correto.
2. Importação real de eventos no formato da agenda, inclusive recorrentes e com Meet.
3. Cancelamento/remarcação no Google refletidos (cancelada automática / conflito).
4. Renovação do token após > 1 h e, se Externo/Teste, comportamento após 7 dias.
5. Atribuição pelos e-mails reais das consultoras (sem atribuir gestora/organizadora).
6. Instalação PWA em aparelhos reais (Android/Chrome e iPhone/Safari).

---

## 6. Backup e restauração

- **Backups do Railway:** no serviço Postgres, *Backups* → habilite agendamento (diário + semanal). Teste uma restauração antes de entrar em produção.
- **Backup lógico manual** (antes de mudanças grandes):
  ```bash
  railway connect Postgres   # ou use a DATABASE_PUBLIC_URL
  pg_dump --format=custom --no-owner "$DATABASE_PUBLIC_URL" -f visitas-$(date +%F).dump
  ```
- **Restaurar em banco novo** (nunca por cima do de produção sem antes salvar o atual):
  ```bash
  pg_restore --no-owner --clean --if-exists -d "$NOVO_DATABASE_URL" visitas-AAAA-MM-DD.dump
  ```
  Depois aponte `DATABASE_URL` dos dois serviços para o banco restaurado e redeploy.
- Os dumps contêm dados pessoais (nomes, telefones, observações): guarde criptografados e com acesso restrito.
- Os tokens do Google no banco estão criptografados com `TOKEN_ENCRYPTION_KEY`; guarde a chave separada do dump. Sem a chave, basta reconectar a conta Google.

---

## 7. Rotação de segredos

| Segredo | Como rotacionar | Efeito |
|---|---|---|
| `GOOGLE_CLIENT_SECRET` | Gere novo segredo no Google Cloud → atualize a variável nos 2 serviços → redeploy → remova o antigo | Tokens existentes continuam válidos |
| `TOKEN_ENCRYPTION_KEY` | Troque nos 2 serviços → redeploy → **Agenda Google → Reconectar** | Tokens antigos ficam ilegíveis; a reconexão grava novos |
| Senha do Postgres | Pelo Railway (variáveis de referência atualizam) → redeploy | — |
| Sessões de usuários | Desativar usuário encerra as sessões dele; trocar a própria senha encerra as outras sessões | — |
| `SETUP_TOKEN` | Remova após o primeiro admin | Tela de configuração inicial deixa de funcionar |

Se suspeitar de vazamento do refresh token: **Desconectar** no app (revoga no Google) e reconectar.

---

## 8. Rollback

- **Código:** no Railway, *Deployments → versão anterior → Redeploy*. Faça em web **e** worker.
- **Migrações:** são aditivas por padrão. Antes de qualquer migração destrutiva futura, faça backup lógico. Se uma migração nova quebrar, o pré-deploy falha e a versão anterior continua no ar. Para desfazer uma migração já aplicada, crie uma nova migração corretiva (não edite migrações aplicadas) ou restaure o backup.
- **Integração Google com problema:** desconecte na tela Agenda Google; o app segue funcionando com cadastro manual.

---

## 9. Operação

- Logs: JSON estruturado (`event`, códigos de erro, contagens) — sem títulos, telefones, observações ou tokens.
- Falhas temporárias do Google: até 4 tentativas por chamada com backoff exponencial; entre execuções, espera crescente (até 1 h).
- Token inválido (410): reconstrução automática do espelho por sincronização completa, sem apagar resultados.
- Reconciliação completa diária detecta eventos que sumiram da agenda.
- Worker reiniciado no meio de uma execução: a execução é marcada “interrompida” e a próxima segue normalmente (estado persistido no banco).
