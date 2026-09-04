# Plano de desenvolvimento — AI Attendant

Plano de execução do agente de suporte WhatsApp → Jira. A fonte de verdade das
decisões de arquitetura é o **claude.md** — este plano não repete justificativas,
apenas referencia as seções (§) de lá. Quando os dois divergirem, vale o claude.md.

Regras de uso:

- Não avançar para a próxima fase com a anterior sem validação.
- Todos os identificadores (tabelas, colunas, estados, tools, env vars) usam os
  nomes em **inglês** definidos no claude.md §3 e §6. A versão anterior deste
  plano usava nomes em português — foram todos alinhados.
- Cada fase termina com **Validação** (como provar que funciona) e **Critério de
  conclusão** (quando marcar a fase como fechada).

Legenda de status:

- `[ ]` Não iniciado
- `[-]` Em andamento
- `[x]` Concluído
- `[~]` Bloqueado / pendente de decisão

---

## Mapa de fases e dependências

| Fase | Entrega | Depende de | claude.md §12 |
|---|---|---|---|
| 0 | Alinhamento e convenções | — | — |
| 1 | Bootstrap: projeto, env, Fastify, Postgres, Docker, webhook eco | 0 | Etapa 1 |
| 2 | Fila, dedupe, lock por conversa, retry | 1 | Etapa 2 |
| 3 | Estado da conversa, debounce, anti-loop, timeout | 2 | Etapa 3 |
| 4 | Identificação do colaborador, onboarding, CSV | 3 | — (pré-requisito da 5 e 7) |
| 5 | Camada de IA, triagem, contrato de ações | 3, 4 | Etapa 4 |
| 6 | Agente de FAQ e contexto externo | 5 | Etapa 5 |
| 7 | Agente de ticket e criação no Jira | 5 | Etapa 6 |
| 8 | Mídia: áudio (whisper.cpp) e imagens | 2, 7 | Etapa 7 |
| 9 | Handoff humano e pausa | 3 | Etapa 8 |
| 10 | Acompanhamento de chamados e webhook do Jira | 7 | Etapa 9 |
| 11 | Operação: healthcheck, QR, rate limit, horário, retenção | 1–10 | Etapa 10 |
| 12 | Empacotamento open source | tudo | Etapa 11 |

As fases 6 e 7 podem andar em paralelo depois da 5. A fase 9 só depende da 3.
O restante é sequencial.

---

## Fase 0 — Alinhamento e convenções

### Objetivo
Garantir que a base conceitual está registrada e que as convenções de trabalho
estão definidas antes do primeiro commit de código.

### Checklist
- [x] Decisões de arquitetura registradas e fechadas (claude.md §2, §13)
- [x] Padrão de código definido (claude.md §3)
- [x] Modelo de dados definido (claude.md §6)
- [x] Converter claude.md e plan.md para UTF-8 (estavam em ISO-8859-1)
- [x] Definir convenção de branches: trunk-based, `main` estável, branches
  curtas `feat/...`, `fix/...` mescladas por PR ou commit direto (dev solo)
- [x] Mensagens de commit em inglês, imperativas, escopo curto
  (ex.: `add debounce window logic`)

### Critério de conclusão
- Qualquer sessão de desenvolvimento futura consegue começar lendo claude.md +
  este plano, sem decisão pendente de arquitetura.

---

## Fase 1 — Bootstrap: projeto, env, Fastify, Postgres, Docker

### Objetivo
Projeto TypeScript rodando em container, com env validada (falha rápida),
migrations automáticas no boot e o webhook da Evolution respondendo eco.
Valida a integração ponta a ponta **antes de qualquer IA** (claude.md §12).

### Arquivos desta fase
```
package.json  tsconfig.json  .eslintrc / eslint.config  .prettierrc
src/server.ts
src/config/env.ts
src/routes/whatsapp.ts
src/db/index.ts  src/db/migrate.ts  src/db/migrations/001_initial.sql
Dockerfile  docker-compose.yml  .env.example
fixtures/messagesUpsert.text.json
```

### 1.1 Projeto e tooling
- [x] `npm init`, Node 22 LTS, `"type": "module"`
- [x] Dependências mínimas: `fastify`, `zod`, `pg` (justificativa de cada uma:
  claude.md §2; nada além disso nesta fase)
- [x] Dev: `typescript`, `tsx`, `@types/node`, `@types/pg`, `eslint`, `prettier`
- [x] `tsconfig.json` com `strict: true`, `NodeNext`, target ES2022 (claude.md §3)
- [x] ESLint + Prettier com configuração padrão, sem customização de estilo
- [x] Scripts: `dev` (tsx watch), `build` (tsc), `start` (node dist),
  `lint`, `format`, `test` (`node --import tsx --test src/`)
- [x] Testes com `node:test` nativo — zero dependência de runner (regra KISS §3)
- [x] Sem `dotenv`: em dev, `node --env-file=.env` / tsx equivalente; em
  produção o compose injeta via `env_file`

### 1.2 Estrutura de pastas
- [x] Criar a árvore exata do claude.md §5: `src/{config,routes,queue,services,services/ai,logic,db/migrations,types}`,
  `prompts/`, `knowledge/`, `fixtures/`
- [x] Respeitar a direção de dependência `routes → logic → services`
  (claude.md §3) desde o primeiro arquivo

### 1.3 Configuração de ambiente (`config/env.ts`)
- [x] Schema Zod validando `process.env` no boot; erro imprime **todas** as
  variáveis inválidas/ausentes e encerra o processo (exit 1)
- [x] Variáveis desta fase: `PORT` (default 3000), `DATABASE_URL` (obrigatória)
- [x] Regra do projeto: cada fase **adiciona** suas variáveis ao schema quando
  passa a usá-las — nunca antes (evita env morta)
- [x] `.env.example` criado junto e mantido em sincronia com o schema
- [x] Nenhuma credencial no repositório (conferir `.gitignore`: `.env` já coberto)

### 1.4 Servidor Fastify (`server.ts`)
- [x] Fastify com logger pino embutido (JSON em produção, pretty em dev)
- [x] `GET /health` → `{ status: "ok", uptime }` (usado pelo compose healthcheck)
- [x] Handler de erro global logando com contexto; resposta 500 sem stack
- [x] Graceful shutdown em SIGTERM/SIGINT (fecha servidor e pool do Postgres) —
  necessário para `docker compose down` limpo

### 1.5 Postgres e migrations
- [x] `db/index.ts`: `pg.Pool` a partir de `DATABASE_URL`
- [x] `db/migrate.ts`: runner próprio (~40 linhas, sem lib — claude.md §3):
  lê `db/migrations/*.sql` em ordem, aplica as pendentes em transação,
  registra em `schema_migrations(name, applied_at)`; roda no boot antes do
  `listen` (claude.md §6: migrations automáticas no boot)
- [x] `001_initial.sql` cria as **cinco tabelas** do claude.md §6 de uma vez —
  o modelo está fechado, não há motivo para pingar tabela por fase:

```sql
create table employees (
  phone       text primary key,
  name        text not null,
  department  text not null,
  email       text,
  source      text not null check (source in ('csv', 'auto')),
  created_at  timestamptz not null default now()
);

create table conversations (
  phone               text primary key,
  state               text not null default 'idle'
    check (state in ('idle','collecting','awaitingConfirmation','humanHandling','closed')),
  partial_data        jsonb not null default '{}',
  last_interaction_at timestamptz not null default now(),
  paused_until        timestamptz
);

create table messages (
  id                  bigint generated always as identity primary key,
  whatsapp_message_id text unique,          -- dedupe (claude.md §7 anti-loop)
  phone               text not null,
  direction           text not null check (direction in ('inbound','outbound')),
  source              text not null check (source in ('user','bot','human')),
  type                text not null check (type in ('text','audio','image')),
  content             text,
  created_at          timestamptz not null default now()
);
create index messages_phone_created_idx on messages (phone, created_at desc);

create table tickets (
  jira_key             text primary key,
  phone                text not null,
  last_notified_status text,
  created_at           timestamptz not null default now()
);
create index tickets_phone_idx on tickets (phone);

create table context_cache (
  url        text primary key,
  content    text not null,
  updated_at timestamptz not null default now()
);
```

- [x] App inicia com banco vazio sem erro

Nota: `db/queries.ts` nasce na fase 2 com a primeira query real (insert de
mensagem com dedupe) — criá-lo vazio agora violaria o KISS do claude.md §3.
A conversão `snake_case → camelCase` acontece **só** nessa camada.

### 1.6 Docker e compose
- [x] `Dockerfile` multi-stage: build (tsc) → runtime `node:22-slim`, usuário
  não-root. **Ainda sem ffmpeg/whisper** — entram na fase 8
- [x] `docker-compose.yml`: serviços `app` + `db` (postgres:16-alpine, volume
  `pgdata`, healthcheck `pg_isready`, `app` com `depends_on: condition: service_healthy`)
- [x] Serviço `evolution` **comentado** no compose, com as env mínimas
  documentadas (claude.md §9)
- [x] `docker compose up --build` sobe app + banco do zero

### 1.7 Webhook eco da Evolution
- [x] `routes/whatsapp.ts`: `POST /webhook/whatsapp` aceita o payload de eventos
  da Evolution, loga `event` + remetente + tipo, responde `200` imediatamente
- [x] Validação Zod **mínima e tolerante** do envelope (event, instance, data) —
  payload desconhecido loga e responde 200 (nunca 4xx/5xx para a Evolution
  reentregar à toa)
- [x] Primeira fixture real: `fixtures/messagesUpsert.text.json` (payload
  `messages.upsert` de texto, sanitizado — sem telefone real)
- [x] Documentar no README (esqueleto): como apontar o webhook da Evolution para
  `http://app:3000/webhook/whatsapp` na rede interna

### Validação
- `npm run dev` sem `.env` → processo cai com lista clara de variáveis faltando
- `docker compose up` → `/health` responde, migrations aplicadas (conferir
  `schema_migrations` via psql)
- `curl -d @fixtures/messagesUpsert.text.json` → 200 + log estruturado do evento
- `npm run lint` e `npm run build` limpos

### Critério de conclusão
- Ponta a ponta validado sem IA: container sobe do zero, env inválida derruba o
  boot, webhook aceita fixture. Nada de lógica de negócio ainda.

### Notas de execução (2026-09-03)
- Fase validada de ponta a ponta no compose local: migrations aplicadas,
  `/health` ok, fixture aceita 5x com 200, lint/build/testes verdes,
  fail-fast confirmado sem `DATABASE_URL`.
- **Supabase vinculado** (CLI via `npx supabase`, sem virar dependência):
  projeto `AI-ttendant`, ref `bwemqvwulovzhgjhwrmv`, região `sa-east-1`,
  Postgres 17. `supabase/config.toml` versionado; `.temp` ignorado.
- O host direto `db.<ref>.supabase.co` resolve **somente IPv6**; a conexão usa
  o **session pooler** (`aws-0-sa-east-1.pooler.supabase.com:5432`, IPv4).
- O pooler apresenta certificado de **CA própria do Supabase** (cadeia não
  publicamente confiável) → `sslmode=no-verify` na connection string
  (TLS sem verificação de CA). Endurecimento com CA pinada: fase 11.
- `docker-compose.yml` usa `${DATABASE_URL:-postgres do compose}`: a URL do
  `.env` (Supabase) tem prioridade; sem ela, sobe o Postgres local.
- **Migrations aplicadas no Supabase** em 2026-09-03: as 6 tabelas
  (`employees`, `conversations`, `messages`, `tickets`, `context_cache`,
  `schema_migrations`) existem no schema `public` do projeto remoto.
  `/health` e o webhook validados contra o banco real.

---

## Fase 2 — Fila, dedupe, lock por conversa e retry

### Objetivo
Webhook responde em milissegundos e todo o trabalho pesado acontece fora do
request, com garantia de: nenhum evento processado duas vezes, nenhuma conversa
processada em paralelo, falha externa com retry e backoff (claude.md §8).

### Decisão registrada nesta fase
**Fila em memória, no próprio processo** (sem Redis/BullMQ — claude.md §3, cada
dependência precisa de justificativa; §13 descartou low-code/infra extra):

- A serialização por telefone **é** o lock: uma cadeia FIFO por `phone`, um task
  por vez; telefones diferentes processam em paralelo.
- Trade-off aceito: crash do processo perde o que estava na fila. Mitigação: a
  mensagem inbound já está persistida em `messages` antes do enqueue, o volume é
  baixo e o usuário reenvia. Multi-instância está **fora de escopo** (documentar).

### Arquivos desta fase
```
src/queue/index.ts     # fila FIFO por telefone
src/queue/worker.ts    # execução com retry/backoff
src/services/evolution.ts
src/logic/guards.ts    # nasce aqui (filtros de evento)
```

### 2.1 Ingestão no webhook
- [x] Extrair do payload: `whatsappMessageId`, `phone` (normalizado — ver 4.1),
  `type` (`text`/`audio`/`image`), conteúdo, `fromMe`, `pushName`
- [x] Filtros ANTES de qualquer persistência (claude.md §8 "ignorar por padrão"):
  - [x] grupos (`remoteJid` termina em `@g.us`)
  - [x] status (`status@broadcast`)
  - [x] listas de transmissão (`@broadcast`)
  - [x] eventos que não são mensagem (ack, presence etc. — roteados depois,
    fases 3 e 11)
- [x] Persistir inbound em `messages` e enfileirar; responder 200 **sempre**

### 2.2 Deduplicação
- [x] Dedupe atômico via banco: `insert into messages ... on conflict
  (whatsapp_message_id) do nothing returning id` — sem linha retornada =
  reentrega da Evolution → descarta o evento com log `debug`
- [x] Cobre reentrega da Evolution e replay de fixture nos testes

### 2.3 Fila e lock (`queue/index.ts`)
- [x] `enqueue(phone, task)`: mapa `phone → fila FIFO`; um task em execução por
  telefone; ao esvaziar, remove a entrada do mapa
- [x] Log com contexto em cada transição (enqueued, started, finished, failed) —
  sempre incluindo `phone` e `whatsappMessageId` (claude.md §3, erros)

### 2.4 Retry e backoff (`queue/worker.ts`)
- [x] Wrapper de execução: 3 tentativas, backoff exponencial (1s → 5s → 25s)
- [x] Só operações externas re-tentáveis (IA, Jira, envio Evolution) — erro de
  lógica não re-tenta
- [x] Esgotou tentativas: log `error` com contexto completo + descarte; a partir
  da fase 9, também notifica via canal de alerta
- [x] `services/` lança, `worker` decide — sem try/catch espalhado (claude.md §3)

### 2.5 Envio de mensagens (`services/evolution.ts`)
- [x] `sendText(phone, text)` via API da Evolution; após sucesso, registrar a
  mensagem outbound em `messages` com o **ID retornado** e `source = 'bot'` —
  este registro é a base da detecção de handoff (fase 9)
- [x] Registrar outbound só após sucesso do envio (retry não pode duplicar linha)
- [x] `setPresence(phone, 'composing')` já criado aqui (usado na fase 3)

### Testes
- [x] `node:test`: fila serializa mesmo telefone e paraleliza telefones diferentes
- [x] Dedupe: replay da mesma fixture não gera segundo processamento
- [x] Filtro de grupo/status/broadcast com fixtures dedicadas
  (`fixtures/messagesUpsert.group.json` etc.)

### Validação
- Enviar a mesma fixture 5x seguidas → 1 processamento
- Duas fixtures do mesmo número → processadas em sequência (verificar nos logs)

### Critério de conclusão
- Milhares de eventos podem chegar com a garantia de: resposta imediata ao
  webhook, processamento em série por conversa, zero duplicação funcional.

### Notas de execução (2026-09-03)

**Dois desvios deste plano, ambos justificados pelo claude.md §5:**

1. Os filtros de evento **não** foram para `logic/guards.ts` e sim para
   `logic/inboundMessage.ts`, que transforma o payload cru numa decisão
   (`process` ou `ignore` com motivo). O claude.md §5 reserva `guards.ts` para
   "anti-loop, limites, validação de ações", que nascem nas fases 3 e 5.
2. A normalização de telefone antecipou da fase 4.1 para cá: o telefone é a
   chave da fila *e* a coluna `messages.phone`. Mora em `inboundMessage.ts` e
   é exportada para o import de CSV reusar na fase 4.

**Decisões do mantenedor:** variáveis da Evolution obrigatórias (sem modo
dry-run) e tarefa placeholder respondendo confirmação fixa.

**`LOG_LEVEL` acrescentado ao schema de env** (default `info`). Descoberto na
validação: os logs `debug` de motivo de descarte, duplicata e ordem da fila
eram inalcançáveis com o nível fixo, contrariando o claude.md §3 ("log com
contexto suficiente para identificar a conversa"). Registrado no claude.md §10.

**Detalhes de implementação que valem lembrar:**
- JID no formato `@lid` é ignorado com motivo próprio: ali os dígitos são um
  identificador interno, não telefone, e aceitá-lo cadastraria colaborador
  fantasma na fase 4.
- `AbortSignal.timeout(10s)` em toda chamada à Evolution — sem isso, uma
  Evolution pendurada travaria a cadeia daquele telefone para sempre.
- Falha do banco na ingestão loga `error` e ainda responde 200: devolver 5xx
  provocaria tempestade de reentrega. A mensagem se perde; trade-off explícito.
- `worker.ts` usa `import timers from "node:timers/promises"` (acesso por
  propriedade) porque o `import` nomeado não é interceptado pelo mock de
  timers do `node:test` — com o import nomeado, a suíte levava 12 s.

**Validado (lint, build e 43 testes verdes, 2 deles de banco):**
- Dedupe: 5 entregas idênticas → 1 linha inbound + 1 resposta.
- Filtros grupo/status/`fromMe`: 200, zero linhas gravadas.
- Imagem e áudio classificados corretamente (legenda vira conteúdo; áudio fica
  `null` até a transcrição da fase 8).
- **Lock por conversa**, com stub de 1,5 s de latência: telefones distintos
  iniciam com 20 ms de diferença, enquanto a 2ª mensagem do mesmo telefone só
  inicia no instante exato em que a 1ª termina.
- Outbound gravado com `source='bot'` apenas após envio bem-sucedido.

**Não validado manualmente:** retry/backoff de ponta a ponta contra uma
Evolution morta — coberto por teste automatizado (`worker.test.ts` verifica as
3 tentativas, os intervalos de 1 s e 5 s e que `NonRetryableError` não é
retentado).

### Validação com WhatsApp real (2026-09-03)

Ponta a ponta confirmado contra a instância `comerx` (Evolution v2.3.7 local,
porta 8081) e o Supabase de produção: mensagem "Teste evolution api" recebida,
enfileirada, respondida em **2,4 s**, com as duas linhas gravadas
(`inbound/user/text` e `outbound/bot/text`). Seis mensagens de grupo chegaram
no mesmo período e foram descartadas com `reason: group`, como manda o
claude.md §8.

**Três armadilhas de configuração encontradas no caminho** (todas documentadas
no `.env.example` para quem clonar):

1. `EVOLUTION_INSTANCE` é o **nome** da instância, não o id. O UUID devolve
   404, porque a rota é `/message/sendText/{nome}`. Descobrir com
   `GET /instance/fetchInstances`.
2. A URL depende de onde o app roda: `localhost:8081` (app no host),
   `evolution:8080` (ambos no compose) ou `host.docker.internal:8081` (app no
   compose, Evolution no host).
3. **A instância não tinha webhook configurado** — sem isso a Evolution recebe
   a mensagem e nunca chama o backend. Registrado com
   `POST /webhook/set/comerx`, url `http://localhost:3000/webhook/whatsapp`,
   evento `MESSAGES_UPSERT` e `byEvents: false` (com `true`, a Evolution
   anexaria o nome do evento à URL e bateria em 404).

### `[x]` Endereçamento `@lid` — descoberto na validação e corrigido

A mensagem de teste chegou com `addressingMode: "lid"`: `remoteJid` era
`205394026717326@lid` e o telefone real estava em **`key.remoteJidAlt`**
(`553799718888@s.whatsapp.net`). Funcionou porque a Evolution normalizou antes
de entregar, mas `parseWebhookEvent` lia apenas `remoteJid` e descartaria como
`unresolvable-phone` se o payload viesse cru — o que na fase 4 significaria
não identificar o colaborador.

Corrigido com `resolvePhoneJid`: quando `remoteJid` termina em `@lid`, o
telefone vem de `remoteJidAlt`; o descarte só acontece quando nenhum dos dois
resolve para um `@s.whatsapp.net`. Coberto por três testes e pela fixture
`messagesUpsert.lid.json`, montada a partir do payload real capturado.

---

## Fase 3 — Estado da conversa, debounce e anti-loop

### Objetivo
Tratar rajadas de mensagens como um bloco único, manter estado explícito por
conversa no banco e impedir loops (claude.md §7).

### Arquivos desta fase
```
src/logic/debounce.ts      # decisões puras (testável sem timer real)
src/logic/conversation.ts  # máquina de estados e transições válidas
src/logic/guards.ts        # anti-loop
src/queue/debounceBuffer.ts# timers e buffer por telefone (o I/O fica aqui)
```

Separação intencional: `logic/` **não faz I/O nem segura timer** (claude.md §3) —
`logic/debounce.ts` responde "devo esperar mais? devo processar agora?" a partir
de timestamps; quem agenda `setTimeout` é a camada de fila.

### 3.1 Máquina de estados (`logic/conversation.ts`)
- [x] Estados exatamente como no claude.md §6:
  `idle · collecting · awaitingConfirmation · humanHandling · closed`
- [x] Tabela de transições válidas (única fonte, exportada para testes):

| De | Para | Gatilho |
|---|---|---|
| `idle` | `collecting` | triagem decide abrir ticket (fase 5) |
| `collecting` | `awaitingConfirmation` | todos os campos coletados (fase 7) |
| `awaitingConfirmation` | `idle` | ticket criado ou coleta cancelada |
| qualquer | `humanHandling` | handoff (fase 9) |
| `humanHandling` | `idle` | retomada (fase 9) |
| qualquer | `closed` | timeout de inatividade |
| `closed` | `idle` | nova mensagem chega (conversa "renasce" limpa) |

- [x] Transição inválida: log `warn` + no-op (nunca corromper estado)
- [x] Toda transição logada com `phone`, estado anterior e novo (auditoria)
- [x] Upsert de `conversations` na primeira mensagem de um número

### 3.2 Debounce
- [x] Buffer em memória por telefone; cada mensagem inbound reinicia a janela
- [x] `DEBOUNCE_SECONDS` (default 10) e `DEBOUNCE_MAX_SECONDS` (default 45)
  entram no schema de env agora
- [x] Janela venceu → concatenar as mensagens do bloco em um único texto de
  entrada, na ordem de chegada
- [x] Teto de 45s vale mesmo com mensagens pingando (não estender para sempre)
- [x] Best-effort: se evento de presença indicar "digitando" quando a janela
  vence, estender uma vez até o teto (requer assinar `PRESENCE_UPDATE`; se a
  Evolution não entregar presença de forma confiável, seguir sem — não é
  bloqueante)
- [x] Ao fechar a janela e antes de processar: `setPresence('composing')`
  (claude.md §7)
- [x] Atualizar `last_interaction_at` a cada mensagem do usuário

### 3.3 Anti-loop (`logic/guards.ts`)
- [x] Regra dura (claude.md §7): **bot nunca envia duas mensagens seguidas sem
  resposta do usuário**. Implementação: antes de enviar, consultar a última
  mensagem da conversa em `messages`; se for `outbound` do bot → suprimir e
  logar. Exceção única: notificações de status do Jira (fase 10), que são
  atualizações solicitadas, não conversa
- [x] Dedupe por `whatsapp_message_id` (já garantido na fase 2 — referência)
- [x] Estado explícito no banco (3.1) fecha a terceira camada do claude.md §7

### 3.4 Timeout e encerramento
- [x] `CONVERSATION_TIMEOUT_HOURS` (default 24) no schema de env
- [x] Sweeper: `setInterval` (a cada 10 min) marca `closed` conversas com
  `last_interaction_at` vencida e **limpa `partial_data`** (claude.md §7 — a
  pessoa não pode voltar dias depois num contexto velho)
- [x] Mensagem nova em conversa `closed` → `idle` com contexto zerado

### Testes
- [x] Tabela de transições: todas as válidas passam, inválidas são no-op
- [x] Debounce puro: sequências de timestamps → decisões (esperar/processar)
- [x] Guard anti-loop: última outbound do bot → envio suprimido

### Validação
- Mandar 3 fixtures do mesmo número em 5s → um único bloco processado, uma
  única resposta (eco por enquanto)
- Forçar timeout com `CONVERSATION_TIMEOUT_HOURS` baixo → conversa fecha e
  `partial_data` zera

### Critério de conclusão
- Rajadas viram bloco único; estado persiste e sobrevive a restart; é impossível
  o bot responder duas vezes seguidas.

### Notas de execução (2026-09-03)

**Desvio consciente no anti-loop (3.3).** A regra literal — "última mensagem é
outbound do bot → suprime" — quebra junto com o debounce. Cenário: usuário
manda "oi" (10:00:00), a janela fecha e o bot começa a processar (10:00:10), o
usuário complementa (10:00:11), a resposta ao primeiro bloco é gravada
(10:00:12); quando o segundo bloco fecha (10:00:21) a última mensagem do banco
é a do bot, **mais nova** que a do usuário, e a complementação morreria em
silêncio. Digitar enquanto espera é comum.

Implementado: suprimir só quando **nada do usuário motivou o envio** (bloco
vazio) ou quando **já há 2 respostas do bot sem resposta** (loop real). A
garantia contra resposta dupla passa a ser estrutural — dedupe por
`whatsapp_message_id` mais um bloco gerando exatamente uma resposta. Preserva a
intenção do claude.md §7; há teste dedicado fixando a decisão.

**Presença (3.2) — confirmada no código-fonte da Evolution, não suposta:**
- O evento repassa o payload do Baileys sem alterar:
  `data.presences[<jid>].lastKnownPresence`.
- A presença **só chega depois de `presenceSubscribe`**, e a Evolution não expõe
  endpoint para isso — mas `POST /chat/sendPresence` chama `presenceSubscribe`
  em todos os caminhos. Ou seja, o próprio "digitando" que o claude.md §7 já
  exige é o que nos inscreve na presença do contato.
- **Consequência aceita:** no primeiro bloco de uma conversa ainda não há
  inscrição, então a extensão por "digitando" vale a partir do segundo bloco.
- **Bug corrigido no `setPresence`:** a Evolution faz `composing` → espera
  `delay` → `paused`. Enviávamos sem `delay`, então o indicador era cancelado no
  mesmo instante e nunca aparecia. Agora vai com 2500 ms e é disparado **sem
  `await`** — a Evolution segura a resposta HTTP durante o delay, e esperar
  somaria 2,5 s a cada resposta.

**Bug pego por teste:** a janela de frescor da presença estava em 15 s, maior
que a própria janela de debounce (10 s) — qualquer "digitando" recebido durante
a janela a estenderia, anulando o propósito. Reduzida para 5 s, que é o que
significa "está digitando agora".

**Validado com 91 testes verdes** (incluindo 5 de banco) e ponta a ponta com
instância isolada na porta 3001:
- **Agrupamento**: 3 mensagens em 4 s → 1 bloco (`blockSize: 3`), texto
  concatenado na ordem, **1 resposta**; banco com 3 inbound e 1 outbound. Antes
  da fase 3 isso gerava 3 respostas.
- **Teto**: mensagem a cada 4 s por 28 s → bloco liberado ao bater o teto com 5
  mensagens, sem nunca cumprir o silêncio.
- **Anti-loop**: mensagem nova logo após uma resposta → **as duas respondidas**
  (é a regressão que a decisão acima evita).
- **Presença**: "digitando" 2 s antes do fim estendeu a janela uma vez
  (`extended: true`), e só uma.
- **Estado**: conversas criadas em `idle` com `partial_data` vazio; sweeper sem
  erros. Fechamento por inatividade e reset `closed` → `idle` cobertos por teste
  de integração.

**Configuração externa aplicada:** o webhook da instância `comerx` agora assina
`MESSAGES_UPSERT` e `PRESENCE_UPDATE`. O procedimento ficou documentado no
`.env.example` para quem clonar.

---

## Fase 4 — Identificação do colaborador e onboarding

### Objetivo
Toda conversa sabe quem é o usuário. Nome de perfil do WhatsApp é sugestão,
nunca identidade (claude.md §7).

### Arquivos desta fase
```
src/logic/onboarding.ts
scripts/importEmployees.ts
```

### 4.1 Normalização de telefone (pré-requisito de tudo)
- [x] Função única de normalização usada em TODOS os pontos de entrada
  (webhook, CSV, envio): somente dígitos, com DDI (`5511999999999`), extraído
  do `remoteJid` da Evolution (`5511999999999@s.whatsapp.net`)
  → **antecipada para a fase 2**: `normalizePhone` em `logic/inboundMessage.ts`
- [x] Estender para os formatos do CSV (com máscara, sem DDI, com espaços) —
  a versão da fase 2 só trata JID da Evolution e rejeita o resto

### 4.2 Identificação e onboarding (`logic/onboarding.ts`)
- [x] Toda mensagem: buscar `employees` pelo telefone normalizado
- [x] Conhecido → contexto do colaborador (nome, setor) vai junto para a IA e
  para o ticket
- [x] Desconhecido → fluxo determinístico (sem IA), com sub-estado em
  `partial_data.onboarding`:
  1. Primeira mensagem: aviso de transparência LGPD (atendimento automatizado +
     como pedir humano — claude.md §11) + pedir o nome. Se `pushName` existir,
     oferecer como sugestão a confirmar ("Você é Fulano?")
  2. Resposta → pedir o setor
  3. Resposta → gravar em `employees` com `source = 'auto'` e seguir o fluxo
     normal da mensagem original
- [x] Perguntar **uma única vez**: colaborador já cadastrado nunca repassa pelo
  onboarding, mesmo em conversa nova

### 4.3 Importação de CSV (`scripts/importEmployees.ts`)
- [x] `npm run import:employees -- caminho.csv`, colunas
  `phone,name,department,email`
- [x] Parser CSV próprio simples (sem lib — arquivos controlados pelo mantenedor)
- [x] Upsert controlado: existente com `source='csv'` atualiza; existente com
  `source='auto'` atualiza e promove para `csv`; relatório final
  (inseridos/atualizados/ignorados/linhas inválidas)
- [x] Telefones passam pela normalização de 4.1; linha inválida não aborta o
  restante

### Testes
- [x] Normalização de telefone
- [x] Onboarding: sequência de mensagens → estados do sub-fluxo → insert final
- [x] Import: fixture CSV com casos válidos e inválidos

### Validação
- Fixture de número desconhecido → bot pergunta nome/setor e cadastra
- Mesmo número de novo → não pergunta de novo
- CSV real de teste importado com relatório correto

### Critério de conclusão
- Usuário conhecido identificado em toda mensagem; desconhecido cadastrado em
  uma conversa fluida.

### Notas de execução (2026-09-04)

**Aviso de transparência removido do bot (decisão do mantenedor).** Os
colaboradores são informados previamente por comunicação interna. O claude.md
§11 foi **editado** para registrar isso como decisão fechada — deixá-lo como
estava faria uma sessão futura reimplementar o aviso achando que era requisito
pendente. A retenção de dados, o outro item de LGPD, continua na fase 11.
Efeito colateral bom: nenhuma coluna nova, nenhuma migration.

**Setor é texto livre** e **`DEFAULT_COUNTRY_CODE`** (default `55`) aplica o DDI
aos telefones do CSV — hardcodar `55` violaria o claude.md §1.

**Onboarding não criou estado novo:** os cinco estados do claude.md §6 seguem
fechados; o sub-fluxo mora em `partial_data.onboarding` com a conversa em
`idle`, e a chave é apagada ao cadastrar.

**Duas armadilhas encontradas e corrigidas:**
1. **DDD 55 vs país +55.** Decidir pelo prefixo trataria `55999887766`
   (Santa Maria/RS) como já internacional, gravando um telefone inalcançável
   para uma região inteira. `normalizeRawPhone` decide por **comprimento**:
   10-11 dígitos é nacional e recebe o DDI; 12+ já o traz. Há teste fixando o
   caso.
2. **`"🔥".length === 2`** em JavaScript (par substituto UTF-16), então um
   emoji sozinho passava como nome válido. A validação passou a contar
   caracteres reais (`[...value].length`), e o truncamento também, para nunca
   partir um caractere ao meio.

**Guarda contra armadilha de fluxo:** quem ignora a pergunta e repete o problema
("socorro preciso urgente") teria isso gravado como nome. Após 2 recusas o valor
é aceito truncado — insistir para sempre prenderia a pessoa num formulário, o
que é pior que um dado imperfeito. Coberto por teste.

**Validado — 130 testes verdes** (13 de banco) e ponta a ponta:
- **Onboarding real**: número desconhecido escreve → bot oferece o nome do
  perfil para confirmar → "sim" → pergunta o setor → "Financeiro" → cadastra
  com `source='auto'` e responde a mensagem original. `partial_data` volta a
  `{}`.
- **Sem repetir**: a mensagem seguinte do mesmo número não passa mais pelo
  cadastro.
- **Import do CSV**: 5 inseridos e 3 inválidos com linha e motivo; máscara,
  zero à esquerda, campo entre aspas com vírgula e DDD 55 tratados
  corretamente. Reimportar o mesmo arquivo dá 5 atualizados, 0 inseridos.
- **Promoção**: importar alguém que o bot havia cadastrado muda `source` de
  `auto` para `csv`.
- **Cabeçalho inválido**: mensagem clara e saída com código 1.

---

## Fase 5 — Camada de IA, triagem e contrato de ações

### Objetivo
Interface única de provedor (Gemini | Claude), triagem por tool use e — regra
inegociável — **nenhuma saída do modelo vira ação sem validação** (claude.md §8).

### Arquivos desta fase
```
src/services/ai/provider.ts   # interface comum
src/services/ai/claude.ts
src/services/ai/gemini.ts
src/services/prompts.ts       # carrega prompt custom ou .example (§9)
src/logic/triage.ts
src/logic/guards.ts           # cresce: validação de ações e limites
src/types/actions.ts          # schemas Zod das tools
prompts/triage.example.md
```

### 5.1 Interface do provedor (`services/ai/provider.ts`)
- [x] Interface mínima orientada ao uso real (multimodal + tool use):
  `complete({ system, messages, tools }) → { toolCall?, text? }` — `messages`
  aceita partes de imagem (base64 + mime) para a fase 8
- [x] `AI_PROVIDER` (`gemini` | `claude`), `AI_API_KEY`, `AI_MODEL` no schema
  de env; factory escolhe a implementação no boot
- [x] `claude.ts`: Messages API com tool use nativo
- [x] `gemini.ts`: function calling equivalente
- [x] Nada fora de `services/ai/` conhece SDK ou formato de provedor

### 5.2 Contrato de ações (`types/actions.ts`)
- [x] Uma tool por ação do claude.md §7, com schema Zod do input:
  - `answerFaq { answer }`
  - `collectTicketData { question?, fields? }`
  - `checkTicketStatus {}`
  - `escalateToHuman { reason }`
- [x] Os mesmos schemas geram as definições de tool enviadas ao provedor
  (fonte única — claude.md §2, motivo da escolha do Zod)

### 5.3 Triagem (`logic/triage.ts`)
- [x] Prompt de triagem montado com: dados do colaborador, estado atual da
  conversa, histórico recente, base de FAQ, MD de contexto externo (quando
  houver — fase 6 liga essa entrada)
- [x] `prompts/triage.example.md` versionado, genérico e funcional; carregado
  via `services/prompts.ts` com fallback (custom se existir → example)
- [x] Saída do modelo validada contra os schemas Zod **antes** de executar;
  campo fora do contrato → rejeita
- [x] Ação rejeitada: log com motivo + resposta neutra ao usuário (sem expor
  erro interno)

### 5.4 Guards de ação (`logic/guards.ts`)
- [x] Limite de tickets por conversa/hora (default 3) — contagem em `tickets`
  por telefone na última hora (claude.md §8, ação irreversível)
- [x] Conversa `humanHandling` ou `paused_until` no futuro → nenhuma ação
  automática
- [x] Falha do provedor após retries: **uma** mensagem de dificuldade técnica
  (respeitando o anti-loop) e log `error`

### 5.5 Histórico e truncamento
- [x] Contexto = últimas N mensagens (default 20, constante interna — só vira
  env se houver motivo)
- [x] Acima de N: gerar/atualizar resumo compacto das antigas, guardado em
  `partial_data.historySummary`, injetado antes do histórico recente
  (claude.md §8, custo controlado)

### Testes
- [x] Provedor fake (fixtures de tool calls) — sem chamar API real
- [x] Saída inválida do modelo → rejeitada, nada executado
- [x] Guard de limite de tickets e de conversa pausada
- [x] Truncamento: conversa longa → contexto = resumo + N recentes

### Validação
- Com chave real em dev: fixture "como configuro a impressora?" → tool
  `answerFaq`; "quero abrir um chamado" → `collectTicketData`; troca de
  `AI_PROVIDER` no `.env` muda o provedor sem tocar código

### Critério de conclusão
- Triagem decide entre as quatro ações com contrato validado; trocar de
  provedor é trocar env; nenhuma saída do modelo age sem passar pelos guards.

### Notas de execução (2026-09-04)

**Provedor: só Gemini** (decisão do mantenedor), via Google AI Studio com o SDK
`@google/genai` v2.21. `claude.ts` fica para quando houver motivo — provedor que
nunca rodou é código que quebra em silêncio. A interface existe porque a segunda
implementação está planejada, o que o claude.md §3 exige.

> **Para quem for implementar `claude.ts`:** a skill `claude-api` (SDK da
> Anthropic) **não se aplica ao `gemini.ts`**. São APIs diferentes. Carregue a
> skill só ao escrever o provedor da Anthropic.

**Superfície da API confirmada nos tipos instalados, não na documentação.** A
doc do `ai.google.dev` mostra `interactions.create` com `steps`; os tipos do SDK
mostram que `interactions` é a superfície de *agents* e que a via de geração é
`models.generateContent`. Confirmado antes de escrever o adaptador:
`config.systemInstruction`, `config.tools[{functionDeclarations}]`,
`config.abortSignal`, e `response.functionCalls`.

**`parametersJsonSchema` aceita JSON Schema cru**, e o Zod 4 tem
`z.toJSONSchema()` nativo — os mesmos schemas geram as declarações de tool e
validam a resposta, sem dependência nova. É a "fonte única" do plan.md 5.2.

**Modelo `gemini-3.8-flash`** como padrão (free tier no AI Studio). O
`.env.example` documenta `gemini-3.1-flash-lite` como alternativa mais barata
para volume alto.

**Schemas estritos (`z.strictObject`), não permissivos.** Um teste pegou que o
Zod por padrão *descarta* campos extras e aceita o resto. Funcionalmente seguro,
mas silencioso: uma tentativa de injeção passaria sem registro. Com estrito, o
campo extra vira rejeição visível no log — que é o ponto, já que os prompts são
públicos (claude.md §8).

**Falha real corrigida durante a validação:** quando a chamada de resumo voltava
sem texto, o código mantinha o resumo anterior **sem logar**, contra o
claude.md §3. Agora registra `warn` — senão o histórico cresceria indefinidamente
sem ninguém perceber.

**Dois arquivos, não um:** a triagem foi para `queue/handleTriage.ts` e o
`processMessage.ts` ficou como roteador (guard → onboarding → triagem). Juntos
passariam de 200 linhas, o limite do claude.md §3.

**Validado — 167 testes verdes** e ponta a ponta contra um Gemini falso
(`GOOGLE_GEMINI_BASE_URL`, sem tocar no código de produção):
- **As quatro ações**: "como configuro a impressora" → `answerFaq` com resposta
  real; "meu notebook não liga" → `collectTicketData` e conversa em `collecting`;
  "como está meu chamado" → `checkTicketStatus`; "quero falar com uma pessoa" →
  `escalateToHuman`.
- **Contrato (o teste que sustenta o §8)**: tool inexistente (`dropDatabase`) →
  `unknown-tool`, nada executado; `answerFaq` com `answer` vazio **e** campo
  injetado → rejeitado com as **duas** violações no log. Nos dois casos o usuário
  recebeu só a mensagem neutra, sem vazar erro interno.
- **Resumo de histórico**: 38 mensagens → 18 turnos compactados, resumo gravado
  em `partial_data` e a triagem seguinte recebeu **20 turnos em vez de 38**.
- **Falha do provedor**: 3 tentativas com backoff de 1 s e 5 s, `error` no log e
  **uma única** mensagem de dificuldade técnica, sem loop.

**Não validado com a API real** — depende da chave do Google AI Studio
(aistudio.google.com/apikey) no `.env`. O free tier do `gemini-3.8-flash` cobre.

---

## Fase 6 — Agente de FAQ e contexto externo

### Objetivo
Responder dúvidas simples **somente** com base na base de conhecimento e no MD
de contexto externo — sem inventar (claude.md §7, §9).

### Arquivos desta fase
```
src/logic/faqAgent.ts
src/services/context.ts
src/routes/github.ts
knowledge/faq.example.md
prompts/faq.example.md
```

### 6.1 Base de conhecimento
- [ ] `knowledge/faq.example.md` versionado com conteúdo genérico funcional
- [ ] Carregamento com fallback: `knowledge/faq.md` (gitignorado) se existir,
  senão o example — mesmo mecanismo de `services/prompts.ts`
- [ ] Adicionar ao `.gitignore`: `prompts/*.md`, `!prompts/*.example.md`,
  `knowledge/faq.md` (hoje o .gitignore não cobre isso)

### 6.2 Contexto externo (`services/context.ts`)
- [ ] `CONTEXT_MD_URL` (opcional) no schema de env; ausente → recurso desligado
  silenciosamente
- [ ] Fetch da URL raw, cache em `context_cache` (tabela da fase 1) com refresh
  por idade (ex.: >10 min → refetch em background; falha de rede → serve cache
  velho e loga)
- [ ] `routes/github.ts`: `POST /webhook/github` com validação HMAC
  (`X-Hub-Signature-256`, `GITHUB_WEBHOOK_SECRET`) sobre o **corpo bruto** —
  push no repo do MD → refetch imediato. Rota só registrada se o secret estiver
  configurado
- [ ] Atenção Fastify: guardar raw body para HMAC (addContentTypeParser ou
  hook) — mesmo mecanismo será reusado no webhook do Jira (fase 10)

### 6.3 Resposta de FAQ (`logic/faqAgent.ts`)
- [ ] Prompt (`prompts/faq.example.md`) instruindo: responder curto, apenas com
  base no material fornecido; sem resposta no material → dizer que não sabe e
  oferecer abrir chamado ou falar com humano
- [ ] Entradas: bloco do usuário, histórico recente, FAQ, contexto externo,
  dados do colaborador
- [ ] Resposta passa pelos guards (anti-loop) antes do envio

### Testes
- [ ] Fallback example/custom para prompts e knowledge
- [ ] HMAC do GitHub: assinatura válida aceita, inválida → 401 + log
- [ ] Cache: expirado → refetch; falha de rede → cache velho

### Validação
- Pergunta coberta pelo FAQ → resposta correta e curta
- Pergunta fora do FAQ → "não sei" + oferta de chamado (nunca invenção)
- Push no repo de contexto → cache atualizado (ou simular com curl assinado)

### Critério de conclusão
- FAQ responde só o que tem suporte no material; contexto externo é opcional e
  atualizável; customização local nunca vai para o git.

---

## Fase 7 — Agente de ticket e criação no Jira

### Objetivo
Coleta guiada perguntando só o que falta, confirmação explícita antes de criar,
criação idempotente com anexos (claude.md §7).

### Arquivos desta fase
```
src/logic/ticketAgent.ts
src/services/jira.ts
prompts/ticket.example.md
```

### 7.1 Serviço Jira (`services/jira.ts`)
- [ ] Env: `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, `JIRA_PROJECT_KEY`
- [ ] Auth básica email + API token (REST v3)
- [ ] `getCreateMeta()`: campos obrigatórios do projeto, buscado no primeiro uso
  e cacheado por boot (claude.md §7 — evita erro pouco descritivo na criação)
- [ ] `createIssue(fields)`: descrição em ADF contendo **nome, setor e telefone**
  do colaborador + relato; reporter é a conta de automação (claude.md §7)
- [ ] `addAttachment(issueKey, buffer, filename)` com header
  `X-Atlassian-Token: no-check`
- [ ] `getIssueStatus(issueKey)` (usado também na fase 10)
- [ ] Tipo de issue: usar o primeiro tipo válido do createmeta por default;
  `JIRA_ISSUE_TYPE` opcional na env (motivo: projetos variam — registrar no
  claude.md §10 ao implementar)

### 7.2 Coleta guiada (`logic/ticketAgent.ts`)
- [ ] Campos do ticket: `summary` (curto), `description` (relato), `category`
  (opcional). Manter mínimo — cada campo extra é uma pergunta a mais
- [ ] Estado da coleta em `partial_data.ticket` (JSONB): campos preenchidos,
  anexos pendentes, flag de criação
- [ ] A cada bloco do usuário: extrair o que já foi dito (via IA), perguntar
  **apenas** o que falta — nunca repetir pergunta respondida (claude.md §7)
- [ ] Conversa em `collecting` durante a coleta (transições da fase 3)

### 7.3 Confirmação explícita
- [ ] Campos completos → montar resumo legível (nome, setor, telefone, resumo,
  descrição, nº de anexos) → enviar → estado `awaitingConfirmation`
- [ ] Só cria com confirmação explícita ("pode abrir", "sim", "confirmo") —
  interpretada pela IA mas **decidida** pela lógica; resposta ambígua →
  re-perguntar uma vez; negativa → cancelar, limpar `partial_data.ticket`,
  voltar a `idle`
- [ ] Sem confirmação → **nunca** cria (claude.md §7)

### 7.4 Criação e idempotência
- [ ] Antes de criar, na ordem: (1) `partial_data.ticket.jiraKey` já existe? →
  conversa já gerou ticket neste ciclo, não cria de novo; (2) guard de máximo
  por hora (fase 5); (3) createmeta ok
- [ ] Criar issue → subir anexos → inserir em `tickets` → responder com a chave
  (`SUP-123`) e o que acontece em seguida → limpar coleta → `idle`
- [ ] Falha ao anexar não desfaz o ticket: loga e avisa que a imagem não subiu
- [ ] Reprocessamento/reentrega não cria segundo ticket (dedupe da fase 2 +
  checagem (1))

### Testes
- [ ] Extração de campos faltantes (o que perguntar dado um `partial_data`)
- [ ] Confirmação: positiva cria, negativa cancela, ambígua re-pergunta
- [ ] Idempotência: fluxo repetido com `jiraKey` preenchido não chama o serviço
- [ ] Jira service com fixtures de resposta (createmeta, create, attach)

### Validação
- Conversa completa em dev contra um projeto Jira real de teste: coleta →
  resumo → "pode abrir" → issue criada com descrição correta e anexo

### Critério de conclusão
- Uma conversa gera no máximo um chamado, sempre confirmado antes, com os dados
  do colaborador na descrição e imagens anexadas.

---

## Fase 8 — Mídia: áudio e imagens

### Objetivo
Áudio vira texto localmente (whisper.cpp); imagem vai ao modelo multimodal e ao
chamado como anexo. Mídia nunca quebra o fluxo principal (claude.md §8).

### Arquivos desta fase
```
src/services/whisperTranscriber.ts   # sem interface: só uma impl (§3, §13)
src/services/evolution.ts            # cresce: download de mídia
Dockerfile                           # cresce: ffmpeg + whisper.cpp
```

### 8.1 Infra de transcrição
- [ ] Dockerfile: instalar `ffmpeg` (apt) e compilar whisper.cpp em stage de
  build (só o binário `whisper-cli` vai ao runtime)
- [ ] Modelo ggml em volume (`/models`), fora da imagem; README documenta o
  download (recomendar `ggml-base` quantizado para PT — bom custo/qualidade em
  CPU)
- [ ] Env: `WHISPER_MODEL_PATH` (default `/models/ggml-base.bin`),
  `WHISPER_LANGUAGE` (default `pt` — claude.md §8, melhora a precisão)
- [ ] Boot: modelo ausente → log `warn` claro, app sobe com áudio desabilitado
  (não derrubar o serviço inteiro por falta de um arquivo opcional)

### 8.2 Pipeline de áudio
- [ ] Download da mídia via Evolution (`getBase64FromMediaMessage` ou payload)
- [ ] `ffmpeg -i in.ogg -ar 16000 -ac 1 out.wav` (OGG/Opus → WAV 16 kHz mono,
  formato que o whisper.cpp exige — claude.md §8)
- [ ] `whisperTranscriber.ts`: spawn do binário, captura do texto, arquivos
  temporários com limpeza em `finally`
- [ ] Transcrição entra no pipeline como mensagem normal: grava em `messages`
  com `type='audio'` e `content=texto`, participa do debounce como texto
- [ ] Limites de sanidade: duração/tamanho máximos (ex.: 5 min / 16 MB);
  acima → tratar como falha
- [ ] Falha (conversão, binário, modelo): **uma** mensagem pedindo para
  escrever ("não consegui ouvir o áudio…"), respeitando o anti-loop; log com
  causa

### 8.3 Pipeline de imagem
- [ ] Download base64 + mime; guardar buffer temporário referenciado em
  `partial_data.ticket.attachments`
- [ ] Imagem entra no contexto multimodal da chamada de IA (interface da fase
  5 já aceita partes de imagem)
- [ ] Na criação do ticket (fase 7), buffers viram anexos no Jira
- [ ] Imagem sem legenda fora de coleta → IA decide na triagem (provavelmente
  `collectTicketData` — print de erro é o caso típico)
- [ ] Falha no download → seguir só com o texto, avisando que a imagem não veio

### Testes
- [ ] Conversão + transcrição com um OGG pequeno de fixture (teste de
  integração local, roda onde houver ffmpeg/whisper — pular em CI se ausentes)
- [ ] Fluxo de falha: transcritor indisponível → mensagem única de fallback

### Validação
- Áudio real em PT pela Evolution → transcrição razoável → triagem normal
- Print de tela → vira anexo do chamado e o modelo o descreve na coleta

### Critério de conclusão
- Áudio e imagem processados com segurança; qualquer falha de mídia degrada
  para texto sem interromper a conversa.

---

## Fase 9 — Handoff humano e pausa automática

### Objetivo
Humano assumiu → bot cala. Detecção via `fromMe` com ID desconhecido
(claude.md §7).

### Arquivos desta fase
```
src/logic/handoff.ts
src/services/alert.ts   # nasce aqui (reusado pelo healthcheck na fase 11)
```

### 9.1 Detecção de mensagem humana (`logic/handoff.ts`)
- [ ] Webhook entrega mensagens `fromMe` (fase 2 já as recebe; agora ganham
  destino): buscar o ID em `messages` outbound
- [ ] ID conhecido → mensagem do próprio bot ecoada, ignorar
- [ ] ID desconhecido → **humano no celular**: gravar em `messages` com
  `source='human'`, transicionar para `humanHandling`, definir `paused_until`
- [ ] `HUMAN_PAUSE_MINUTES` (default 60) na env — o claude.md exige
  `paused_until` mas não fixa a duração; registrar a variável no §10 ao
  implementar

### 9.2 Pausa e retomada
- [ ] Conversa `humanHandling` com `paused_until` no futuro: nenhuma resposta
  automática (guard da fase 5 já bloqueia; aqui garante-se a transição)
- [ ] Mensagem manual nova do humano → renova `paused_until`
- [ ] Retomada: `paused_until` expirado **e** usuário mandou mensagem nova →
  volta a `idle` e o fluxo normal responde
- [ ] `[~]` **Confirmar semântica com o mantenedor**: o claude.md §7 diz
  "até o usuário mandar mensagem nova **ou** expirar paused_until" — lido ao pé
  da letra, qualquer mensagem do usuário retoma o bot mesmo com o humano no
  meio da conversa. Este plano implementa a leitura conservadora acima
  (expiração **e** nova mensagem). Validar antes de fechar a fase
- [ ] Evento de handoff logado para auditoria

### 9.3 Pedido explícito de humano
- [ ] Tool `escalateToHuman` (fase 5) executa: mesma transição + `paused_until`
  + mensagem ao usuário ("vou chamar alguém, você também pode ligar em X")
- [ ] Notificar o mantenedor via `services/alert.ts`

### 9.4 Canal de alerta (`services/alert.ts`)
- [ ] Env: `ALERT_CHANNEL` (`telegram` | `email`) e `ALERT_TARGET`
- [ ] Implementar **telegram primeiro** (um POST na Bot API — mínimo de
  dependência); exige token do bot: propor `ALERT_BOT_TOKEN` na env e registrar
  no claude.md §10
- [ ] `[~]` Email: exige config SMTP não definida no claude.md §10 — só
  implementar se o mantenedor for usar; caso contrário deixar `telegram` como
  única opção documentada
- [ ] Alerta nunca lança para o chamador (falha de alerta só loga)

### Testes
- [ ] `fromMe` com ID conhecido → ignorado; desconhecido → `humanHandling`
- [ ] Guard: conversa pausada não responde
- [ ] Retomada só com pausa expirada + mensagem nova

### Validação
- Em dev: responder manualmente pelo celular no número de teste → bot pausa
  (ver log de transição); esperar expirar + nova mensagem → bot volta

### Critério de conclusão
- Resposta manual do celular silencia o bot naquele número, sem conflito nem
  loop; pedido explícito de humano pausa e notifica.

---

## Fase 10 — Acompanhamento de chamados e webhook do Jira

### Objetivo
Chamado não vira buraco negro: usuário consulta status e recebe aviso quando o
Jira anda (claude.md §7 — parte da v1).

### Arquivos desta fase
```
src/routes/jira.ts
src/logic/ticketStatus.ts
```

### 10.1 Consulta de status (tool `checkTicketStatus`)
- [ ] Buscar em `tickets` os chamados do telefone (mais recentes primeiro,
  limitar a 3)
- [ ] Consultar status atual de cada um no Jira (`getIssueStatus`, fase 7)
- [ ] Resposta curta: chave, resumo, status, desde quando; nenhum chamado →
  dizer isso e oferecer abrir um

### 10.2 Webhook do Jira (`routes/jira.ts`)
- [ ] `POST /webhook/jira` para `jira:issue_updated` (mudança de status)
- [ ] Validar autenticidade com `JIRA_WEBHOOK_SECRET`: HMAC sobre o corpo bruto
  quando o Jira Cloud suportar na configuração usada; fallback documentado:
  token secreto na URL do webhook (`/webhook/jira?token=...`) — registrar a
  escolha no README
- [ ] Payload → issue key → linha em `tickets` → telefone; sem linha → ignorar
  (issue de outro fluxo)
- [ ] **Anti-spam** (claude.md §7): só notificar se o status novo difere de
  `last_notified_status`; após enviar, atualizar a coluna. Reentrega do
  webhook não gera segunda mensagem
- [ ] Notificação enviada mesmo com conversa pausada (é atualização solicitada,
  não diálogo — exceção registrada no guard da fase 3)
- [ ] Mensagem: "Seu chamado SUP-123 mudou: Em andamento → Concluído"

### Testes
- [ ] Fixture de payload do Jira → notificação certa para o telefone certo
- [ ] Mesmo status duas vezes → uma notificação
- [ ] Issue sem linha em `tickets` → ignorada sem erro

### Validação
- Mover um chamado de teste no board do Jira → mensagem chega no WhatsApp
- "como está meu chamado?" → resposta com status real

### Critério de conclusão
- Usuário consulta e é notificado de mudanças, sem spam de reentregas nem de
  transições repetidas.

---

## Fase 11 — Operação, segurança e resiliência

### Objetivo
Proteção ligada por padrão e operação que avisa quando quebra — por canal que
não seja o próprio WhatsApp (claude.md §8).

### Arquivos desta fase
```
src/routes/qr.ts
src/queue/healthcheck.ts     # jobs periódicos
src/logic/businessHours.ts
```

### 11.1 Segurança de entrada
- [ ] Revisar HMAC dos webhooks GitHub (fase 6) e Jira (fase 10): rejeição 401
  com log de tentativa inválida (sem logar o payload)
- [ ] Webhook da Evolution: mesmo em rede interna, proteger com header de token
  compartilhado configurado na Evolution; validar no Fastify
- [ ] Limite de tamanho de payload no Fastify (`bodyLimit`) coerente com mídia
- [ ] Rate limit por telefone em memória (janela deslizante, ex.: 20 msg/min);
  excedente: descarta e responde **uma vez** "muitas mensagens, aguarde um
  instante" (respeitando anti-loop)

### 11.2 Healthcheck da Evolution
- [ ] Job periódico (5 min): `GET /instance/connectionState/{EVOLUTION_INSTANCE}`
- [ ] Estado ≠ `open` detectado → alerta via `services/alert.ts` (fase 9) com o
  link da página do QR — **nunca** via WhatsApp (claude.md §8: é justamente o
  que caiu)
- [ ] Alertar só na transição de estado (conectado→caído) e num lembrete a cada
  X horas — não a cada checagem
- [ ] Recuperou → alerta de normalização

### 11.3 Página de QR code
- [ ] Assinar evento `QRCODE_UPDATED` no webhook; guardar o último QR em memória
- [ ] Ao receber: imprimir em ASCII no log do container (dep. `qrcode-terminal`,
  justificada: exigência explícita do claude.md §8) — visível em
  `docker compose logs -f`
- [ ] `routes/qr.ts`: `GET /qr?token=...` validado contra `QR_PAGE_TOKEN`;
  página HTML com o QR (a Evolution já manda base64) e auto-refresh (~15 s — o
  QR rotaciona em segundos)
- [ ] Sem QR disponível (sessão conectada) → página informa "conectado"
- [ ] README: procedimento de reconexão (não é setup único — claude.md §8)

### 11.4 Horário de atendimento
- [ ] `BUSINESS_HOURS` na env (formato `08:00-18:00`; vazio = 24/7 —
  claude.md §10)
- [ ] Fora do horário: bot atende normalmente, mas avisa **uma vez por
  conversa** (flag em `partial_data`) que um humano só verá no próximo
  expediente (claude.md §11 — senão a pessoa fica esperando)

### 11.5 LGPD e retenção
- [ ] Aviso de transparência na primeira interação — já implementado na fase 4;
  revisar o texto aqui
- [ ] Job diário de retenção: apagar `messages` com mais de
  `DATA_RETENTION_DAYS` (propor default 90; nova env — registrar no claude.md
  §10, motivo já declarado no §11) e conversas `closed` antigas
- [ ] Higiene de log: conteúdo de mensagem nunca em nível `info` — só IDs e
  metadados; conteúdo apenas em `debug` para depuração local

### Testes
- [ ] Rate limit: estouro descarta e avisa uma vez
- [ ] Business hours: parser do formato + casos de virada de dia
- [ ] Retenção: linhas antigas somem, recentes ficam

### Validação
- Derrubar a sessão da Evolution em dev → alerta chega no Telegram com link
  do `/qr` → página mostra QR e atualiza → reescanear reconecta
- Mandar rajada de mensagens → rate limit atua sem loop

### Critério de conclusão
- Sistema avisa a própria queda por canal alternativo, QR acessível e seguro,
  abuso contido, dados com prazo de vida.

---

## Fase 12 — Empacotamento open source

### Objetivo
`git clone` + `.env` + `docker compose up` funcionando na infra de terceiros,
sem nada do ambiente do mantenedor (claude.md §1, §9).

### 12.1 Exemplos e gitignore
- [ ] Conferir versionados: `prompts/triage.example.md`, `prompts/faq.example.md`,
  `prompts/ticket.example.md`, `knowledge/faq.example.md`
- [ ] Conferir gitignorados: `prompts/*.md` (exceto examples), `knowledge/faq.md`
- [ ] Testar o fallback: repositório limpo (sem customizações) sobe e funciona
  com os examples

### 12.2 Fixtures e testes
- [ ] Revisar `fixtures/`: cobrir texto, áudio, imagem, grupo, status, `fromMe`,
  payload do Jira — todos **sanitizados** (nenhum telefone/nome real)
- [ ] `npm test` verde num clone limpo, sem chave de API e sem WhatsApp
  (claude.md §9 — essencial para contribuição)
- [ ] Opcional: GitHub Actions com lint + build + test (justificativa: PRs de
  terceiros num projeto open source; decisão do mantenedor)

### 12.3 Documentação
- [ ] README completo, nesta ordem (claude.md §9):
  1. O que é e o que faz (1 parágrafo + diagrama do §4)
  2. Pré-requisitos (Docker, instância Evolution, projeto Jira, chave de IA)
  3. Subir: clone → `.env` (tabela de variáveis com obrigatória/opcional/default)
     → `docker compose up` → conectar WhatsApp pelo `/qr`
  4. Importar CSV de colaboradores
  5. Customizar prompts e FAQ (mecanismo example/custom, sem vazar conteúdo
     interno)
  6. Baixar o modelo do whisper
  7. Webhooks do Jira e do GitHub (como configurar do outro lado)
  8. Avisos: free tier do Supabase pausa após ~7 dias de inatividade; risco de
     ban do número (resumo honesto do claude.md §11)
  9. Como contribuir (fixtures, testes, padrão de código)
- [ ] `.env.example` final, comentado, espelhando o schema Zod
- [ ] Atualizar claude.md §10 com as envs adicionadas nas fases
  (`JIRA_ISSUE_TYPE?`, `HUMAN_PAUSE_MINUTES`, `ALERT_BOT_TOKEN`,
  `DATA_RETENTION_DAYS`)

### 12.4 Licença e verificação final
- [ ] `LICENSE` MIT
- [ ] Teste de clone limpo: máquina/VM sem nada → seguir só o README → sistema
  funcional. Qualquer tropeço vira correção de README antes de fechar

### Critério de conclusão
- Uma pessoa de fora roda o projeto inteiro seguindo apenas o README.

---

## Aceite final do projeto

Funcionalidade (testável de ponta a ponta):
- [x] Recebe mensagens do WhatsApp e identifica ou cadastra o colaborador (fase 4)
- [ ] Responde FAQ com base no material, sem inventar
- [ ] Abre ticket no Jira com confirmação, dados do colaborador e anexos
- [ ] Consulta e notifica status de chamado
- [ ] Áudio em PT transcrito localmente; imagem vai ao modelo e ao chamado
- [ ] Humano assume → bot pausa; usuário pede humano → pausa + notificação
- [x] Conversa expira e renasce limpa; nenhum loop possível (fase 3)

Qualidade técnica (invariantes — claude.md §8):
- [x] Webhook responde imediato; processamento 100% assíncrono (fase 2)
- [x] Dedupe por `whatsapp_message_id`; lock por conversa; retry com backoff (fase 2)
- [x] Toda saída de modelo validada por Zod antes de agir; limites de ação (fase 5)
- [ ] Webhooks externos autenticados; rate limit ativo
- [x] Migrations no boot; env validada com falha rápida; zero credencial no git (fase 1)

Operação:
- [ ] Compose sobe tudo do zero; `/health` ok; `/qr` protegido e funcional
- [ ] Queda da Evolution alerta por canal alternativo
- [ ] Retenção de dados rodando; aviso LGPD na primeira interação
- [ ] README suficiente para terceiros (teste de clone limpo aprovado)

---

## Pontos a confirmar com o mantenedor

Decisões que este plano tomou onde o claude.md é omisso — vetáveis antes da
fase correspondente:

1. ~~**Fila em memória**~~ — implementada na fase 2 e validada. Crash perde o
   que estava na fila; mitigado por inbound persistido + volume baixo.
   Multi-instância segue fora de escopo.
2. **`node:test` nativo** como runner (fase 1) — zero dependência; trocar por
   vitest é barato se incomodar.
3. **Semântica da retomada pós-handoff** (fase 9.2): claude.md §7 é ambíguo;
   plano adota "pausa expira **e** usuário manda mensagem nova".
4. **Alerta via Telegram primeiro** (fase 9.4); email fica de fora até existir
   config SMTP definida.
5. **Novas envs propostas**: `HUMAN_PAUSE_MINUTES=60`, `ALERT_BOT_TOKEN`,
   `DATA_RETENTION_DAYS=90`, `JIRA_ISSUE_TYPE` (opcional) — todas com motivo
   declarado nas fases; registrar no claude.md §10 quando implementadas.
   Já implementada: `LOG_LEVEL=info` (fase 2), sem a qual os logs `debug` de
   descarte, duplicata e ordem da fila são inalcançáveis.
6. **Campos do ticket** (fase 7.2): mínimo `summary` + `description` +
   `category` opcional. Confirmar se o projeto Jira exige mais.
7. **CI no GitHub Actions** (fase 12.2): recomendado para receber PRs, mas é
   infraestrutura que o claude.md não pediu.
8. **TLS do Supabase com `sslmode=no-verify`** (fase 1): criptografado, porém
   sem verificação de CA — a cadeia do pooler usa CA própria do Supabase. Na
   fase 11, avaliar baixar o certificado CA do projeto e pinar via
   `sslrootcert` para verificação completa.

---

## Próximo passo (atualizado em 2026-09-04)

Fases 0 a 5 concluídas. O agente agora **decide**.

Pendência para o mantenedor: pôr a chave do Google AI Studio em `AI_API_KEY`
(aistudio.google.com/apikey) e validar com WhatsApp real — as quatro ações foram
testadas contra um provedor falso, mas nunca contra o Gemini de verdade.

Próxima: **fase 6 — agente de FAQ e contexto externo**. A entrada de base de
conhecimento já existe no prompt de triagem, mas chega vazia: falta
`knowledge/faq.example.md`, o carregamento com fallback e o MD de contexto
externo por URL com cache.

### Ambiente do mantenedor (funcionando)
- Supabase `bwemqvwulovzhgjhwrmv` via session pooler; migrations aplicadas.
- Evolution v2.3.7 no host, porta 8081, instância `comerx` conectada, com
  webhook apontando para `http://localhost:3000/webhook/whatsapp`.
- Subir com `npm run dev`; `LOG_LEVEL=debug` mostra descartes e ordem da fila.

---

## Próximo passo (fase 1, histórico)

Fase 1 completa, na ordem 1.1 → 1.7. Primeiro checkpoint concreto:
`docker compose up --build` subindo app + Postgres, migrations aplicadas, e
`curl -d @fixtures/messagesUpsert.text.json localhost:3000/webhook/whatsapp`
devolvendo 200 com log estruturado.
