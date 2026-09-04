# AI-ttendant

Agente de suporte interno via WhatsApp: responde dúvidas com base de
conhecimento e abre/acompanha chamados no Jira, conversando pela Evolution API.

- Arquitetura e decisões fechadas: [claude.md](claude.md)
- Plano de execução por fases: [plan.md](plan.md)

> **Status:** Fases 1 a 6 concluídas — o agente identifica o colaborador,
> agrupa rajadas de mensagens e decide entre responder com a base de
> conhecimento, coletar dados de chamado, consultar chamado, escalar para
> humano ou apenas reconhecer a mensagem. A abertura no Jira chega na fase 7.

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

## Base de conhecimento

O agente só responde o que estiver em [knowledge/faq.example.md](knowledge/faq.example.md).
Copie para `knowledge/faq.md` (ignorado pelo git) e ponha o conteúdo real da sua
empresa — o que não estiver lá vira oferta de chamado, nunca resposta inventada.
Os prompts seguem o mesmo padrão em [prompts/](prompts/). Os arquivos são lidos
no boot: alterou, reinicie.

Para avisos do momento ("o sistema X está em manutenção hoje"), aponte
`CONTEXT_MD_URL` para um markdown cru no GitHub — ele tem prioridade sobre a
base de conhecimento. Com `GITHUB_WEBHOOK_SECRET` configurado, um push atualiza
na hora em vez de esperar os 10 minutos do cache.

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
