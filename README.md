# AI-ttendant

Agente de suporte interno via WhatsApp: responde dúvidas com base de
conhecimento e abre/acompanha chamados no Jira, conversando pela Evolution API.

- Arquitetura e decisões fechadas: [claude.md](claude.md)
- Plano de execução por fases: [plan.md](plan.md)

> **Status:** Fases 1 e 2 concluídas — servidor Fastify, Postgres com migrations
> no boot, Docker, e o webhook da Evolution ingerindo mensagens com
> deduplicação, fila com lock por conversa e retry com backoff. A resposta ainda
> é uma confirmação fixa: o agrupamento de mensagens chega na fase 3 e a IA na
> fase 5. README completo chega na fase 12.

## Rodar em desenvolvimento

Pré-requisitos: Node 22+, Docker.

```bash
cp .env.example .env        # ajuste DATABASE_URL (ver comentários no arquivo)
npm install
docker compose up -d db     # Postgres local (pule se usar Supabase)
npm run dev
```

Na Evolution API, aponte o webhook da instância para
`http://app:3000/webhook/whatsapp` (rede interna do compose) ou
`http://localhost:3000/webhook/whatsapp` em dev.

Testar o webhook com uma fixture (sem WhatsApp real):

```bash
curl -X POST -H "Content-Type: application/json" \
  -d @fixtures/messagesUpsert.text.json \
  http://localhost:3000/webhook/whatsapp
```

As fixtures em [fixtures/](fixtures/) cobrem texto, imagem, áudio e os casos
que o bot ignora por padrão (grupo, status, mensagem do próprio número).
Eventos ignorados e duplicatas descartadas aparecem apenas com
`LOG_LEVEL=debug` — é por onde se investiga por que uma conversa não foi
respondida.

## Rodar tudo com Docker

```bash
docker compose up --build
```

Sem `DATABASE_URL` no `.env`, o app usa o Postgres do próprio compose. Com ela
definida (ex.: Supabase), ela tem prioridade.

## Banco de dados

Postgres puro por connection string — sem ORM e sem SDK de provedor. Migrations
em `src/db/migrations/` aplicadas automaticamente no boot. Usando Supabase,
conecte pelo **session pooler** (porta 5432, IPv4); detalhes no `.env.example`.

## Scripts

| Comando | O que faz |
|---|---|
| `npm run dev` | Servidor com watch e `.env` |
| `npm test` | Testes (`node:test`) |
| `TEST_DATABASE_URL=... npm test` | Inclui os testes de banco (pulados sem essa variável, para nunca escrever no banco de produção) |
| `npm run lint` / `npm run format` | ESLint / Prettier |
| `npm run build` / `npm start` | Compila e roda o build |
