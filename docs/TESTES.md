# Testes de aceitação — mapa

Todos com **dados sintéticos**. Integração usa Postgres real; a API do Google é **simulada** (`tests/helpers/mock-calendar.ts`).

| # | Critério | Onde |
|---|---|---|
| 1 | Evento padrão atribuído pela consultora convidada, campos extraídos | `unit/parser.test.ts` (extração, atribuição); `integration/sync.test.ts` “importa visita padrão…” |
| 2 | Referência adicional ≠ código; telefone do Meet ≠ telefone do cliente | `unit/parser.test.ts` “número de referência…”, “telefone do Google Meet e PIN…” |
| 3 | Nenhuma/duas consultoras, dados incompletos, números inválidos → revisão sem descarte | `unit/parser.test.ts`; `integration/sync.test.ts` “nenhuma/duas consultoras…” |
| 4 | Almoço, reunião, visita técnica não entram | `unit/parser.test.ts` “classificação”; `integration/sync.test.ts` (não persiste irrelevantes) |
| 5 | Sync repetido, paginação, concorrência sem duplicar; cancelamento, recorrência, remarcação | `integration/sync.test.ts` (idempotência, incremental, recorrência, cancelamento, 410, janela, reconciliação, recriação, lock) |
| 6 | Consultora não lê/altera alheias (API, URL, cliente compartilhado); gestão vê tudo | `integration/domain.test.ts` “autorização”; `e2e/flows.spec.ts` “não acessa visita alheia por URL nem por API” (inclui CSRF) |
| 7 | Observação inválida rejeitada no servidor; horário não marca realizada | `integration/domain.test.ts` “conclusão”; constraint SQL `Visit_conclusion_requires_note` |
| 8 | Duplo clique, retry, edição simultânea | `integration/domain.test.ts` “duplo clique…”, “edição simultânea…”, “cadastro manual repetido…” |
| 9 | Várias visitas não multiplicam fechamentos; telefones ambíguos não fundem | `integration/domain.test.ts` “oportunidades e clientes” |
| 10 | Taxas com conjunto conhecido, zero, pendentes, coorte aberta, fechamento em outro mês | `unit/metrics.test.ts` |
| 11 | Fluxo mobile, erro/offline, PWA, desktop | `e2e/flows.spec.ts` (Pixel 7 e 1366×900, Chrome) |
| 12 | Reconexão, restart do worker, persistência | `integration/sync.test.ts` “falha de autorização marca reconexão”, “estado persiste após reinício”, “lock liberado” |

## Não coberto por automação (exige ambiente real)

- OAuth real com Google (tela de consentimento, troca de código, renovação de token, expiração de 7 dias em modo Teste).
- Leitura de eventos reais (formato exato do Meet na descrição em português, recorrências reais).
- Instalação PWA em aparelhos físicos Android/iPhone (a E2E valida manifest, ícones, service worker e página offline em Chrome desktop/emulação).
- Healthcheck/pré-deploy no Railway (validados localmente com instalação de produção `npm ci --omit=dev`).
