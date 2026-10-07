# Visitas Locação

Registro rápido de **todas** as visitas de locação (inclusive as que não avançam) e métricas confiáveis para a gestão.
Web responsivo + PWA instalável, interface em português, fuso `America/Sao_Paulo`.

> Nome provisório. Sistema independente da planilha de negócios: sem importação do Excel, comissões ou financeiro.

## Fluxo principal

1. A visita é marcada na agenda central do Google com a consultora convidada.
2. O **worker** importa o evento (somente leitura) e atribui a visita à consultora pelo **e-mail convidado**.
3. Após a visita, a consultora abre **Hoje** → **Registrar resultado** → informa se aconteceu, o resultado, o motivo (se negativa) e a observação → **Salvar** (confirmação real do servidor).
4. A gestora acompanha **Painel**, **Revisão** (atribuições, conflitos, eventos ambíguos, vínculos de clientes) e **Andamento** (oportunidades).

## Stack

| Item | Escolha |
|---|---|
| Runtime | Node.js 22 (`.nvmrc`, `engines`) |
| App | Next.js 16 (App Router) + React 19 + TypeScript 6 |
| Banco | PostgreSQL (16 testado) + Prisma 7 (`@prisma/adapter-pg`) |
| UI | Tailwind CSS 4, elementos HTML nativos acessíveis (rádios, selects, rótulos visíveis) |
| Google | `@googleapis/calendar` + `google-auth-library` (OAuth no servidor, somente leitura) |
| Senhas | Argon2id (`@node-rs/argon2`) |
| Telefones | `libphonenumber-js` |
| Testes | Vitest (unidade + integração em Postgres real) e Playwright (fluxos) |

## Arquitetura

```
src/
  lib/          regras puras e infraestrutura
    parser.ts     classificação/extração determinística dos eventos (sem IA)
    phone.ts      normalização de telefone (sem inventar dígitos)
    metrics.ts    indicadores (funções puras, definições no topo do arquivo)
    authz.ts      TODAS as regras de permissão (centralizadas)
    session.ts    sessão em banco, cookie HttpOnly/Secure/SameSite
    crypto.ts     AES-256-GCM para tokens do Google
  server/       serviços de domínio (transações + auditoria)
    visits.ts, clients.ts, opportunities.ts, queries.ts, review.ts
    sync/         engine.ts (sincronização), google.ts (API real), runner.ts (lock/backoff)
  worker/index.ts  processo persistente de sincronização
  app/          telas e rotas (Next.js)
prisma/          schema + migrações (inclui constraints SQL extras)
tests/           unit, integration, e2e
```

Dois processos com o mesmo código: **web** (`npm run start`) e **worker** (`npm run worker`).

### Modelo de dados (resumo)

- `User` (ADMIN / MANAGER / CONSULTANT, ativo/desativado) e `UserEmailAlias` (e-mails reconhecidos na agenda).
- `Session`, `PasswordResetToken` (hash, uso único, 24 h), `RateLimit`.
- `GoogleConnection` (conta, calendário selecionado, papel de acesso, tokens criptografados), `SyncState` (syncToken, janela), `SyncRun` (diagnóstico), `WorkerHeartbeat`.
- `EventPattern` (padrões de visita / exclusão / revisão), `Reason` (motivos de negativa e de perda; desativáveis).
- `SourceEvent` — espelho mínimo do Google; chave única `(calendarId, id da ocorrência)`. Eventos irrelevantes não são guardados.
- `Visit` — situação operacional, avaliação, motivo, observação, `version` (concorrência otimista), `lastRequestId` (idempotência), `manualFields` (correções que a sincronização não sobrescreve), `syncConflict`.
- `VisitOutcomeHistory` — histórico de registros/observações.
- `Client` + `ClientPhone` (valor original e normalizado; identidade confirmada/pendente), `Property` (código **texto**).
- `Opportunity` (cliente+imóvel, ciclos; índice único parcial: 1 ativa por par) + `OpportunityEvent`.
- `AuditLog`, `AppSettings` (singleton com regras configuráveis).

Constraints no banco: observação obrigatória para conclusão humana, avaliação só em realizada, negativa exige motivo, fechamento exige data+responsável, perda exige motivo/observação.

## Regras de negócio e decisões (ajustáveis)

| Decisão inicial | Onde ajustar |
|---|---|
| Resultado: positiva / negativa / ainda decidindo (positiva ≠ contrato) | `src/lib/labels.ts`, enum `Evaluation` |
| Negativa exige motivo; toda conclusão exige observação (limite 2.000) | Configurações → limite; motivos em **Motivos** |
| Consultora responsável e gestão atualizam andamento | `src/lib/authz.ts` + Regras e app |
| Consultora pode corrigir dados e cadastrar visita manual | Regras e app |
| Padrão `Visita clt`, exclusões (visita técnica, almoço, reunião…), termos para revisão | **Padrões de eventos** |
| Janela: 30 dias antes / 90 depois; intervalo 5 min; botão manual a cada 60 s | Regras e app |
| Data de início da cobrança (sem cobrança retroativa) | Regras e app |
| Visita **negativa** encerra a oportunidade como perdida (origem “visita negativa”); positiva/decidindo abre ou continua a oportunidade; nova visita após encerramento abre novo ciclo | `src/server/opportunities.ts` |
| Remarcada conta como conclusão registrada na cobertura (contagem mostrada à parte) | `src/lib/metrics.ts` |
| Organizador do evento não conta como convidado para atribuição | `assignConsultant` em `src/lib/parser.ts` |
| Mesmo telefone + nome compatível (primeiro nome igual ou nomes contidos) = mesmo cliente; caso contrário, revisão | `src/server/clients.ts` |
| Número isolado antes de `cod` é guardado como “referência externa” (significado não confirmado) | `parseVisitEvent` |

### Precedência Google × app

- A sincronização **nunca** altera resultado, observação, vínculo de cliente confirmado manualmente, atribuição manual nem campos corrigidos no app (`manualFields`).
- Antes da conclusão, horário e dados importados acompanham o Google (mudança de horário fica na auditoria).
- Depois da conclusão, diferenças viram **conflito** para revisão (“aplicar dados da agenda” ou “manter”).
- Cancelamento/exclusão no Google: sem resultado → “cancelada (Google)” automaticamente; com resultado → conflito, resultado preservado.
- Evento recriado: religado automaticamente só com mesmo `iCalUID` + mesma ocorrência original; semelhança por telefone/imóvel vai para revisão.

### Métricas

Definições exibidas no painel e documentadas em `src/lib/metrics.ts`. Denominador zero mostra **“Sem base”**. A conversão é por **coorte de oportunidades**; fechamentos usam a data do fechamento e contam 1 vez por oportunidade.

## Desenvolvimento local

Pré-requisitos: Node 22, PostgreSQL.

```bash
npm install
cp .env.example .env              # preencha DATABASE_URL, APP_URL=http://localhost:3000, TOKEN_ENCRYPTION_KEY
npx prisma migrate dev            # cria o banco local e gera o cliente
npm run icons                     # (opcional) regenera ícones
SEED_PASSWORD='uma-senha-local' npm run db:seed:dev   # dados SINTÉTICOS (recusa produção)
npm run dev                       # app em http://localhost:3000
npm run worker:dev                # worker de sincronização (outro terminal)
```

Criar administrador sem seed: `npm run admin:create -- --email voce@dominio --name "Seu Nome"` (pede a senha), ou acessar `/configuracao-inicial` com `SETUP_TOKEN` definido.

OAuth local: cadastre `http://localhost:3000/api/google/callback` como URI de redirecionamento no Google Cloud.

## Testes

```bash
npm run typecheck
npm test                    # unidade + integração (requer Postgres; usa TEST_DATABASE_URL ou ...:54329/visitas_test)
npm run test:e2e            # Playwright (requer `npm run build` antes e banco E2E_DATABASE_URL com "e2e" no nome)
```

- Integração usa **Postgres real** e uma **API Google simulada** (`tests/helpers/mock-calendar.ts`, identificada como mock).
- Os testes se recusam a rodar em bancos sem `test`/`e2e` no nome.
- E2E usa o Chrome instalado (`channel: "chrome"`); em Linux/CI defina `PW_CHANNEL=` vazio e rode `npx playwright install chromium`.

Mapa dos critérios de aceitação → testes: veja [docs/TESTES.md](docs/TESTES.md).

## Publicação

Produção: Railway, projeto `app_aluguel` (infra em `.railway/railway.ts`). **Todo push na `main` publica automaticamente.** Veja **[docs/DEPLOY.md](docs/DEPLOY.md)** (Google Cloud, checklist, backup/restauração, rotação de segredos, rollback).

## Segurança (resumo)

- Sem cadastro público; usuários criados pela gestão/admin; link de senha de uso único (24 h).
- Sessão em banco (token aleatório, só o hash é guardado), cookie `__Host-` HttpOnly/Secure/SameSite=Lax em HTTPS.
- Server Actions com verificação de origem do Next; rotas `/api` exigem `Origin` do próprio app + cabeçalho `x-requested-with`.
- Limitação de tentativas (login por IP e por e-mail, reset, sync manual).
- Autorização no servidor em toda consulta/mutação (`src/lib/authz.ts`); consultora recebe 404 para registros alheios.
- Tokens do Google criptografados (AES-256-GCM), nunca enviados ao navegador ou aos logs.
- Logs estruturados sem títulos, telefones, observações ou tokens; auditoria restrita à gestão.
- Descrição dos eventos convertida em texto puro sanitizado; bloco do Meet removido.
- Service worker só armazena arquivos estáticos e a página offline; nunca APIs ou páginas autenticadas.

## Limitações conhecidas

- Envio exige conexão; não há fila offline (por decisão do MVP).
- Sem e-mail transacional: links de senha são entregues pela gestão.
- Um calendário central por vez.
- Integração Google testada apenas com mock nesta entrega (ver docs/DEPLOY.md, “Validação real pendente”).
