# Visitas Locação

Registro rápido de **todas** as visitas de locação (inclusive as que não avançam) e métricas confiáveis para a gestão.
Web responsivo + PWA instalável, interface em português, fuso `America/Sao_Paulo`.

> Nome provisório. Sistema independente da planilha de negócios: sem importação do Excel, comissões ou financeiro.

## Fluxo principal

1. A visita é marcada na agenda central do Google com a consultora convidada.
2. O **worker** importa o evento (somente leitura) e atribui a visita à consultora pelo **e-mail convidado**.
3. Após a visita, a consultora abre o app — **tela única “Minhas visitas”** (sem menus: “Para registrar”, “Próximas” e “Registradas”) → toca no card → informa se aconteceu, o resultado, o motivo (se negativa) e a observação → **Salvar** (confirmação real do servidor).
4. A gestora acompanha **Painel**, **Revisão** (atribuições, conflitos, eventos ambíguos, vínculos de clientes) e **Andamento** (oportunidades).

### Recursos adicionais

- **Revisita e quem agendou:** visita de cliente que já tinha visita realizada aparece como **Revisita** (com quantas vezes já visitou e se foi no mesmo imóvel). Quando é a consultora que marca — pelo botão **Agendar nova visita** no detalhe (dados do cliente pré-preenchidos) ou criando o evento na agenda com o próprio e-mail — a visita fica marcada como **Agendada pela consultora**, separada das marcadas pela agenda central. Também vai para o CSV.
- **Próxima pendente:** após salvar um resultado, a consultora vai direto para a próxima visita aguardando registro.
- **Ligar / WhatsApp:** botões no card e no detalhe (somente com telefone validado; apenas abrem o contato, nada é enviado automaticamente).
- **Lembretes no celular (Web Push):** ativados por cada pessoa no menu da conta. Envio diário (hora configurável, exceto domingo) pelo worker: consultora recebe a contagem das próprias pendências > 24 h; gestora recebe o resumo da equipe. Conteúdo só com contagens. No iPhone exige o app instalado na tela de início (iOS 16.4+).
- **Evolução semanal** no painel (8 semanas, segunda a domingo): agendadas, realizadas, positivas e cobertura.
- **Marca Auxiliadora Predial** (logotipo e símbolo em `public/brand`, ícones do app gerados com `npm run icons`).
- **Modo escuro** automático, seguindo o aparelho.
- **Foto e título do imóvel** lidos da página pública do anúncio (`og:image`/`og:title`), a partir do link configurável com `{codigo}`; atualizados pelo worker em lotes pequenos, com cache de 7 dias. Só o código do imóvel é enviado.
- **Respostas rápidas** e lembrete de ditado na observação; **Desfazer** por 5 s após o primeiro registro.
- **Painel:** destaque de pendência acumulada (> 24 h) por consultora e **meta de cobertura** configurável (padrão 90%).
- **Gestão:** página de cada imóvel (desempenho e motivos de recusa), funil de locação com tempos médios, Andamento em lista ou quadro (arrastar), oportunidades paradas, botão **Cobrar** pendências e resumo semanal automático às segundas.
- **Consultora:** busca de visitas antigas, alterar senha, aviso de instalação do app, prévia do imóvel ao cadastrar visita manual.
- **Tela simples no celular** opcional também para a gestão (menu da conta).
- **Lembretes por e-mail** para quem não ativou notificações (opcional, via Resend: `RESEND_API_KEY` e `EMAIL_FROM`).
- **Registro de erros próprio** (navegador, servidor e worker), sem dados pessoais, no Diagnóstico; admin é avisado no celular quando surge um erro novo.
- **CI:** GitHub Actions roda typecheck, testes (Postgres real), build e E2E; o Railway só publica quando a verificação passa.
- **Relatório mensal em PDF** (gestão → Relatórios): resumo executivo com comparação ao mês anterior e destaques automáticos, comparação entre consultoras (tabela + gráficos com média da equipe e meta), evolução de 6 meses, funil, motivos, imóveis, qualidade dos dados, metodologia e uma ficha por consultora. Gerado no servidor com `@react-pdf/renderer` (fonte Manrope e logotipo em `assets/`). Aviso à gestão no dia 1.
- **LGPD:** aviso de privacidade (`/privacidade`) com ciência registrada no primeiro acesso; exclusão a pedido do titular (página do cliente) e retenção automática (padrão 24 meses) por **anonimização** — remove nome, telefones e observações, preservando os indicadores; a sincronização não regrava dados de cliente anonimizado; aviso ao digitar documentos (CPF/RG) na observação.
- **Rota do dia** (`/rota`): visitas da consultora em ordem de horário, com intervalo entre elas (alerta quando há menos de 20 min entre bairros diferentes) e um botão que abre o Google Maps com todas as próximas paradas, saindo da localização atual (até 10 paradas). Cada parada também abre no Maps ou no Waze. O endereço vem do campo **Local** do evento na agenda ou é informado no app (fica salvo no imóvel; a agenda não sobrescreve o que foi digitado). Sem endereço, usa o bairro do anúncio (marcado como “só o bairro”). A gestão escolhe a consultora.
- **Mapa da rota:** a rota do dia abre num mapa (Leaflet + OpenStreetMap) com as paradas numeradas na ordem, a linha do trajeto de carro, “onde estou” (só no aparelho) e mini-cards deslizantes sincronizados com os marcadores. Tempo e distância de carro entre visitas (OSRM) entram no alerta de intervalo apertado (intervalo menor que o trajeto + 5 min). Coordenadas vêm do endereço (ou do bairro, marcado como aproximado) via Nominatim, com cache no imóvel; o worker adianta as visitas dos próximos 3 dias. Só o endereço do imóvel sai do sistema. `MAP_SERVICES=off` desliga as consultas externas.
- **Antes de entrar** (ficha da visita): ao abrir uma visita, a consultora vê fotos do anúncio, total com encargos, aluguel, condomínio, IPTU, área, quartos e bairro; as visitas anteriores do cliente (só as dela — mesma regra das revisitas; a gestão vê todas) com motivo e observação; os números do imóvel na equipe (sem nomes); e **pontos para a conversa** gerados por regras fixas: compara preço, tamanho e bairro com o imóvel que o cliente recusou (“Achou caro o 761739 (R$ 2.300). Este sai R$ 400 mais barato”), lembra dúvidas e faltas anteriores e antecipa a objeção mais citada no imóvel. O lembrete antes da visita abre direto a ficha.
- **Hoje ao vivo** (`/ao-vivo`, gestão): o dia de cada consultora agora (registradas, em andamento, sem resultado, próximas), último registro, pendências de dias anteriores, atalho para a rota e para **Cobrar**. Atualiza sozinho a cada minuto.
- **Contador:** o número de visitas para registrar (inclui as em andamento) aparece no menu e no ícone do app instalado (Badging API; Android/Chrome e iPhone com o app na tela de início).
- **“Como foi a visita?”:** notificação logo após o término. No Android vem com atalhos (Gostou / Não gostou / Não veio) que abrem o registro já marcado — a observação continua obrigatória. Sem resultado depois de N horas (padrão 2), novo aviso; depois de N horas (padrão 24), alerta agrupado à gestão. Silêncio das 21h às 8h para os avisos que podem esperar. Configurável em Regras e app.
- **Termômetro do imóvel** (Imóveis): classifica cada imóvel dos últimos 90 dias em Encalhado / Atenção / Saudável / Poucas visitas (regras fixas, com volume mínimo), mostra o motivo mais citado, compara com imóveis parecidos (mesmo bairro e tipo, aluguel ±25%) e com a média da agência e sugere uma ação objetiva pelo motivo.
- **Relatório do imóvel para o proprietário** (PDF, página do imóvel): visitas, quantos gostaram, motivos padronizados, comparação com parecidos e agência, visitas por mês e recomendação. Sem nomes, telefones, observações ou nomes da equipe. Períodos de 90 dias, 6 meses, 12 meses ou tudo.
- **Dados do anúncio:** além de foto e título, o worker lê do JSON-LD da página tipo, bairro, cidade, aluguel, total, área e quartos (o endereço do JSON-LD é o da agência e é ignorado).
- **Exportar CSV** (gestão) com os filtros do Histórico; separador `;`, compatível com Excel, proteção contra fórmulas e registro na auditoria.

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
