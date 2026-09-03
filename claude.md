# Agente de Suporte via WhatsApp ? Jira

Contexto do projeto para o Claude Code. Este documento é a fonte de verdade das
decisões de arquitetura. **As decisões marcadas como FECHADAS não devem ser
reabertas ou "melhoradas" sem o desenvolvedor pedir** ? cada uma foi tomada com
um motivo registrado aqui.

---

## 1. O que é

Um agente de atendimento que atende colaboradores internos pelo WhatsApp
corporativo, responde dúvidas simples usando uma base de conhecimento, e quando
o caso exige, conduz uma conversa estruturada para coletar as informações
necessárias e abrir um chamado no Jira ? notificando a pessoa quando o chamado
andar.

**Contexto do mantenedor:** desenvolvedor solo que acumula os papéis de dev e
suporte. O objetivo do projeto é devolver tempo a ele, não construir uma
plataforma.

**O projeto é open source (MIT).** Outras pessoas vão clonar e rodar na
infraestrutura delas. Isso é um requisito de design, não um detalhe: nada pode
ser hardcoded para o ambiente do mantenedor, e o projeto precisa funcionar logo
após `git clone` + preencher `.env`.

---

## 2. Stack (FECHADA)

| Camada | Escolha | Motivo |
|---|---|---|
| Linguagem | Node.js + TypeScript | Serviço I/O-bound orquestrando APIs; tipagem forte ajuda na extração estruturada dos campos do ticket |
| HTTP | Fastify | Leve, boa integração com TypeScript |
| Validação | Zod | Schemas compartilhados entre tool use da IA e validação de entrada |
| Banco | PostgreSQL | Via string de conexão pura |
| Hospedagem | Container Docker no servidor da empresa | Mesmo host da Evolution API |
| WhatsApp | Evolution API | Já existente na empresa |
| IA | Camada abstrata: Gemini ou Claude via `.env` | Ambos multimodais (necessário para prints de tela) |
| Transcrição | whisper.cpp local | Sem custo, sem chave de API, sem enviar áudio a terceiros |
| Tickets | Jira Cloud REST API v3 | Plano free, auth por email + API token |

### Não fazer

- **Não usar Vercel nem serverless.** Foi avaliado e descartado: o plano Hobby
  proíbe uso comercial (a definição inclui funcionário pago escrevendo o
  código), o limite de 4,5 MB no corpo da requisição quebra webhooks com mídia,
  cron no Hobby roda uma vez por dia (inviabiliza o healthcheck), e transcrição
  local exige processo persistente com o modelo em memória ? o oposto de
  serverless.
- **Não acoplar ao SDK do Supabase.** Falar Postgres puro por string de conexão.
  O mantenedor usa Supabase; quem clonar pode usar o Postgres do próprio
  compose. Trocar de banco deve ser trocar uma variável no `.env`.
- **Não hardcodar prompts no código.** Ver seção 9.
- **Não confiar na saída do modelo sem validação.** Ver seção 8.

---

## 3. Padrão de código (OBRIGATÓRIO)

### Idioma

**Todo o código é em inglês.** Nomes de variáveis, funções, tipos, arquivos,
tabelas, colunas, mensagens de commit e comentários.

Exceções, ambas intencionais:

- **Texto que o usuário final lê** (prompts, mensagens do bot, base de FAQ) é em
  **pt-BR** ? os colaboradores são brasileiros.
- **Documentação de projeto** (`CLAUDE.md`, `README.md`) é em pt-BR.

### Nomenclatura

| Elemento | Convenção | Exemplo |
|---|---|---|
| Variáveis e funções | `camelCase` | `pendingMessages`, `buildTicketPayload` |
| Tipos, interfaces, classes | `PascalCase` | `Conversation`, `AiProvider` |
| Constantes e env vars | `UPPER_SNAKE_CASE` | `DEBOUNCE_SECONDS` |
| Arquivos | `camelCase.ts` | `faqAgent.ts`, `whisperTranscriber.ts` |
| Tabelas e colunas do banco | `snake_case` | `whatsapp_message_id` |

O banco usa `snake_case` porque é a convenção do PostgreSQL (identificador sem
aspas é normalizado para minúsculas). A conversão para `camelCase` acontece na
camada de queries ? o resto do código nunca vê `snake_case`.

### Arquitetura limpa, na medida certa

Três camadas, com direção de dependência única:

```
routes/  ?  logic/  ?  services/
```

- **`routes/`** é fina. Valida entrada, enfileira, responde. Nenhuma regra de
  negócio.
- **`logic/`** contém as decisões. Recebe dados, devolve decisões. **Não faz I/O
  direto** ? o que a torna testável sem rede, sem banco e sem WhatsApp.
- **`services/`** fala com o mundo externo (Evolution, Jira, IA, banco). Não
  conhece regra de negócio.

Regras: `logic/` nunca importa de `routes/`. `services/` nunca importa de
`logic/`. Se precisar quebrar isso, o desenho está errado.

Isso é o suficiente de "arquitetura limpa" para este projeto. **Não introduzir**
camadas de domínio/aplicação/infra separadas, repositórios genéricos,
containers de injeção de dependência, CQRS, event sourcing ou padrões
equivalentes. O projeto é um orquestrador de chamadas de API mantido por uma
pessoa.

### KISS ? regras concretas

Estas não são conselhos, são regras do projeto:

- **Sem abstração antes da segunda implementação real.** Uma interface só existe
  quando há dois usos concretos. Por isso `services/ai/` tem interface (Gemini e
  Claude existem de fato) e a transcrição **não** tem (só whisper local). Quando
  aparecer a segunda, extrai-se a interface ? não antes.
- **Sem ORM.** SQL direto, com queries nomeadas em `db/queries.ts`.
- **Funções, não classes**, salvo quando houver estado real a encapsular.
- **Sem configuração que ninguém pediu.** Só vira variável de ambiente o que tem
  motivo declarado neste documento.
- **Sem camada de utilitários genérica.** Nada de `utils/helpers.ts` virando
  depósito. Função pequena mora perto de quem usa.
- **Arquivo que passa de ~200 linhas** é sinal de que faz duas coisas. Dividir
  por responsabilidade, não por tamanho.
- **Explícito ganha de esperto.** Código óbvio e um pouco repetitivo é melhor que
  abstração engenhosa. Quem vai depurar isso às 23h é uma pessoa só.
- **Cada dependência nova precisa de justificativa.** Biblioteca que resolve
  algo que dez linhas resolvem não entra.

### Erros

- **Falhar rápido no boot**: variáveis de ambiente validadas com Zod na subida.
  Config inválida derruba o processo com mensagem clara, não gera erro
  misterioso em produção.
- **Tratar erro nas bordas**: `services/` lança, `queue/worker.ts` decide retry
  ou descarte. Não espalhar `try/catch` defensivo por toda parte.
- **Nunca engolir erro em silêncio.** Log com contexto suficiente para
  identificar a conversa.

### Assincronia

`async/await` em tudo. Sem `.then()` encadeado, sem callback. Promise sem
`await` só com comentário explicando por quê.

### Testes

Foco em `logic/` ? é onde estão as regras e onde o teste paga. Serviços externos
são cobertos por fixtures (`fixtures/`), não por mocks elaborados. Sem meta de
cobertura.

### Ferramentas

ESLint + Prettier com configuração padrão, sem discussão de estilo. `strict: true`
no TypeScript. Sem `any` ? se o tipo é desconhecido, é `unknown` e se valida.

---

## 4. Arquitetura

```
WhatsApp (número corporativo)
        ?
        ?
Evolution API ??????????? webhook ??????????? Backend (Node/TS)
   (mesmo servidor)      (rede interna)            ?
        ?                                          ???? PostgreSQL (Supabase ou local)
        ?                                          ???? IA (Gemini | Claude)
        ??????? envio de mensagem ??????????????????
                                                   ???? whisper.cpp (local, mesmo container)
                                                   ???? Jira Cloud REST v3
                                                   ???? MD de contexto (URL raw, GitHub)

Jira ??? webhook (mudança de status) ??? Backend ??? notifica no WhatsApp
```

Backend e Evolution ficam no mesmo servidor e conversam pela rede interna. Isso
elimina a necessidade de expor a Evolution na internet, remove negociação de
firewall e reduz latência. Nada precisa ser público, exceto opcionalmente os
webhooks de entrada do GitHub e do Jira.

---

## 5. Estrutura de pastas

```
.
??? src/
?   ??? server.ts                 # entrada, Fastify
?   ??? config/
?   ?   ??? env.ts                # carrega e VALIDA env vars (Zod) ? falha rápido no boot
?   ??? routes/
?   ?   ??? whatsapp.ts           # webhook da Evolution
?   ?   ??? jira.ts               # webhook do Jira (mudança de status)
?   ?   ??? github.ts             # webhook do repo de contexto
?   ?   ??? qr.ts                 # página do QR code (protegida por token)
?   ??? queue/
?   ?   ??? index.ts              # fila de processamento assíncrono
?   ?   ??? worker.ts             # consumidor, com retry e backoff
?   ??? services/
?   ?   ??? evolution.ts          # enviar mensagem, presença, connectionState
?   ?   ??? jira.ts               # criar issue, anexar arquivo, consultar status
?   ?   ??? context.ts            # busca e cacheia o MD externo
?   ?   ??? whisperTranscriber.ts # whisper.cpp + ffmpeg (sem interface: só uma impl)
?   ?   ??? ai/
?   ?       ??? provider.ts       # interface comum (tool use, multimodal)
?   ?       ??? claude.ts
?   ?       ??? gemini.ts
?   ??? logic/
?   ?   ??? debounce.ts           # agrupamento de mensagens
?   ?   ??? triage.ts             # decide: FAQ, ticket, consulta, ou escalar
?   ?   ??? faqAgent.ts
?   ?   ??? ticketAgent.ts        # coleta guiada + montagem do ticket
?   ?   ??? handoff.ts            # detecção de atendimento humano
?   ?   ??? guards.ts             # anti-loop, limites, validação de ações
?   ??? db/
?   ?   ??? migrations/
?   ?   ??? queries.ts            # SQL direto; converte snake_case ? camelCase
?   ??? types/
??? prompts/
?   ??? triage.example.md         # VERSIONADO
?   ??? faq.example.md            # VERSIONADO
?   ??? ticket.example.md         # VERSIONADO
?   ??? *.md                      # GITIGNORADO (customização local)
??? knowledge/
?   ??? faq.example.md            # VERSIONADO
?   ??? faq.md                    # GITIGNORADO
??? fixtures/                     # payloads de exemplo da Evolution (testes sem WhatsApp)
??? docker-compose.yml
??? Dockerfile
??? .env.example
??? LICENSE                       # MIT
??? README.md
```

---

## 6. Modelo de dados

Colunas em `snake_case` (convenção do Postgres); o código as expõe em
`camelCase`.

**`employees`** ? fonte de verdade da identificação
`phone` (PK) · `name` · `department` · `email` · `source` (`csv` | `auto`) ·
`created_at`

**`conversations`** ? estado por número
`phone` (PK) · `state` · `partial_data` (jsonb) · `last_interaction_at` ·
`paused_until`

Estados válidos: `idle` · `collecting` · `awaitingConfirmation` ·
`humanHandling` · `closed`

**`messages`** ? histórico
`whatsapp_message_id` (UNIQUE ? usado para deduplicação) · `phone` ·
`direction` (`inbound` | `outbound`) · `source` (`user` | `bot` | `human`) ·
`content` · `type` (`text` | `audio` | `image`) · `created_at`

**`tickets`** ? associação chamado ? conversa
`jira_key` (PK) · `phone` · `last_notified_status` · `created_at`

**`context_cache`** ? MD externo
`url` (PK) · `content` · `updated_at`

Migrations rodam automaticamente no boot. Sem ORM; SQL direto.

---

## 7. Comportamento do agente

### Agrupamento de mensagens (debounce)

Pessoas escrevem em blocos curtos. Processar cada webhook isoladamente gera
respostas fragmentadas e desperdício de API.

- Janela de silêncio configurável, **default 10 segundos** (`DEBOUNCE_SECONDS`)
- Teto máximo de acumulação: 45 segundos (`DEBOUNCE_MAX_SECONDS`)
- Se a presença indicar que a pessoa ainda está digitando quando a janela vence,
  estender
- Ao fechar a janela, enviar presença "digitando" antes de processar
- Todas as mensagens do bloco são concatenadas em um único prompt

**Não usar janelas longas (30s+).** Foi discutido: a percepção é de bot morto, e
a pessoa reage mandando mais mensagem ou ligando ? exatamente o que o projeto
quer evitar.

### Identificação

1. Consulta `employees` pelo telefone
2. Se desconhecido: o bot pergunta nome e setor **uma vez** e cadastra
   (`source = 'auto'`)
3. Carga inicial via importação de CSV (`source = 'csv'`)
4. O nome de perfil do WhatsApp serve apenas como sugestão a confirmar, nunca
   como identidade ? é escolhido pelo usuário e costuma ser inútil

### Triagem

Uma chamada de IA com tool use decide entre:
`answerFaq` · `collectTicketData` · `checkTicketStatus` · `escalateToHuman`

O prompt recebe: histórico recente da conversa, base de FAQ, MD de contexto
externo, dados do colaborador e estado atual.

### Abertura de ticket

- O bot pergunta apenas o que ainda falta (não repete o que já sabe)
- **Sempre confirma antes de criar**: mostra o resumo do chamado e espera o
  "pode abrir"
- Imagens enviadas na conversa viram **anexo** no chamado
- Idempotência: uma conversa gera **um** ticket até ser explicitamente encerrada
- Reporter é uma conta de automação. Colaboradores internos provavelmente não
  têm conta no Jira (plano free tem limite de usuários), e alterar reporter
  exige permissão específica. Nome, setor e telefone da pessoa vão na descrição
- Antes de criar, consultar os metadados de criação do projeto para descobrir
  campos obrigatórios ? evita falha com erro pouco descritivo

### Acompanhamento do chamado (parte da v1)

- Webhook do Jira em mudança de status ? mensagem no WhatsApp para o solicitante
- Usuário pergunta "como está meu chamado?" ? consulta pelos tickets associados
  ao telefone

Sem isso, o chamado vira buraco negro e o mantenedor continua fazendo o
acompanhamento manualmente.

### Handoff humano

A Evolution emite webhook para toda mensagem do número, inclusive as enviadas
manualmente pelo celular. O backend registra o ID de cada mensagem que ele
próprio envia; uma mensagem `fromMe` com ID desconhecido significa que **um
humano assumiu**.

Nesse caso: marcar a conversa como `humanHandling` e **pausar as respostas
automáticas** naquele número, até o usuário mandar mensagem nova ou expirar
`paused_until`.

O usuário também pode pedir explicitamente para falar com uma pessoa ? mesmo
efeito, mais notificação ao mantenedor.

### Anti-loop

Três camadas, todas obrigatórias:

1. Deduplicação por `whatsapp_message_id` (a Evolution pode reentregar)
2. O bot **nunca** envia duas mensagens seguidas sem resposta do usuário
3. Estado explícito da conversa no banco, com transições válidas definidas

### Fim de conversa

Conversa sem interação por `CONVERSATION_TIMEOUT_HOURS` volta para `closed` e o
estado parcial é descartado, para a pessoa não voltar dias depois em um contexto
velho.

---

## 8. Requisitos técnicos obrigatórios

**Processamento assíncrono.** O webhook responde `200` imediatamente e enfileira.
Processar dentro do request (IA + transcrição + Jira = dezenas de segundos) faz
a Evolution considerar timeout e reentregar, gerando resposta duplicada.

**Lock por conversa.** Mensagens do mesmo número nunca processadas em paralelo ?
corrompe o estado da coleta.

**Retry com backoff** em falha de Jira, IA ou envio, com limite e registro.

**Mídia:**
- Áudio do WhatsApp vem em OGG/Opus; whisper.cpp precisa de WAV/PCM ? **ffmpeg é
  dependência da imagem Docker**
- Transcrever com `language=pt` (melhora bastante a precisão)
- Imagens vão direto ao modelo (ambos os provedores são multimodais) e viram
  anexo do chamado

**Truncamento de histórico.** Manter as N últimas mensagens; resumir o excedente.
Sem isso, o custo e a confusão crescem junto com a conversa.

**Segurança (ligada por padrão, não opcional):**
- Validação de assinatura HMAC nos webhooks de GitHub e Jira
- Rate limit por remetente
- **Validar a saída do modelo antes de agir.** Os prompts de exemplo são
  públicos; qualquer pessoa pode tentar manipular o agente. A defesa não é
  esconder o prompt ? é o backend validar campos e limitar ações irreversíveis
  (máximo de tickets por conversa/hora)
- Nenhuma credencial no repositório; tudo por variável de ambiente

**Ignorar por padrão:** mensagens de grupos, listas de transmissão e status. O
número corporativo participa de grupos e o bot não pode responder neles.

**Healthcheck.** Consultar `GET /instance/connectionState/{instance}`
periodicamente. Ao detectar desconexão, notificar por **canal que não seja o
WhatsApp** (email ou Telegram) ? o WhatsApp é justamente o que caiu ? incluindo
o link da página do QR.

**QR code.** Assinar o evento `QRCODE_UPDATED` e, ao receber:
1. imprimir o QR em ASCII no log do container (`docker compose logs -f`)
2. servir em `/qr`, protegido por token, com atualização automática (o QR expira
   em segundos e rotaciona)

Escanear QR não é evento único de setup: quando a sessão é invalidada, alguém
precisa reescanear.

---

## 9. Distribuição open source

**Prompts e base de conhecimento seguem o padrão do `.env`:**

- `prompts/*.example.md` e `knowledge/faq.example.md` são **versionados**, com
  conteúdo genérico e funcional ? quem clona sobe e o bot funciona
- `prompts/*.md` e `knowledge/faq.md` são **gitignorados** ? a customização real,
  com conteúdo interno da empresa, nunca vai para o GitHub
- O código carrega o customizado se existir; senão, cai no exemplo
- O README explica esse mecanismo

Versionar apenas os exemplos entrega um projeto que roda de imediato **e** mantém
o conteúdo interno fora do repositório público. Gitignorar os prompts sem
fornecer exemplos entregaria um projeto que não sobe.

**`docker-compose.yml`** sobe backend + Postgres (opcional, para quem não usa
Supabase). A Evolution pode entrar como serviço opcional comentado.

**`.env.example`** documenta todas as variáveis.

**`fixtures/`** com payloads reais da Evolution permite desenvolver e testar sem
escanear QR nem mandar mensagem de verdade ? essencial para contribuições.

**README** cobre: pré-requisitos, `.env`, subir com compose, conectar o WhatsApp
pelo QR, importar o CSV de colaboradores, customizar prompts e FAQ, e o aviso de
que o free tier do Supabase pausa projetos após ~7 dias de baixa atividade.

---

## 10. Variáveis de ambiente

```
# Server
PORT=3000
QR_PAGE_TOKEN=
LOG_LEVEL=info                # fatal|error|warn|info|debug|trace (fase 2)

# Database
DATABASE_URL=postgres://...

# Evolution
EVOLUTION_BASE_URL=http://evolution:8080
EVOLUTION_API_KEY=
EVOLUTION_INSTANCE=

# AI
AI_PROVIDER=gemini            # gemini | claude
AI_API_KEY=
AI_MODEL=

# Transcription
WHISPER_MODEL_PATH=/models/ggml-base.bin
WHISPER_LANGUAGE=pt

# Jira
JIRA_BASE_URL=https://empresa.atlassian.net
JIRA_EMAIL=
JIRA_API_TOKEN=
JIRA_PROJECT_KEY=
JIRA_WEBHOOK_SECRET=

# External context (optional)
CONTEXT_MD_URL=
GITHUB_WEBHOOK_SECRET=

# Behavior
DEBOUNCE_SECONDS=10
DEBOUNCE_MAX_SECONDS=45
CONVERSATION_TIMEOUT_HOURS=24
BUSINESS_HOURS=               # ex: 08:00-18:00, vazio = 24/7

# Alerts (canal alternativo ao WhatsApp)
ALERT_CHANNEL=                # email | telegram
ALERT_TARGET=
```

---

## 11. Riscos conhecidos

**Ban do número.** A Evolution usa Baileys, implementação não oficial do
WhatsApp Web; automatizar por esse caminho viola os termos de uso e o número
pode ser bloqueado. Decisão consciente do mantenedor: o perfil de uso é de
baixo risco (apenas responde quem chamou primeiro, volume baixo, contatos
internos conhecidos ? bans miram disparo em massa para desconhecidos). A camada
`services/evolution.ts` fica isolada para que migrar à API oficial da Meta seja
troca de peça, não reescrita.

**LGPD.** O sistema armazena conversas de colaboradores e envia esse conteúdo a
um provedor de LLM. Necessários: política de retenção (descartar conversas após
X dias) e aviso na primeira interação de que o atendimento é automatizado.

**Transparência.** A primeira mensagem deve deixar claro que é um agente
automatizado e como pedir atendimento humano.

**Horário de atendimento.** Fora do horário configurado, o bot atende mas avisa
que um humano só verá no próximo expediente ? senão a pessoa fica esperando.

---

## 12. Roadmap

Construir em etapas testáveis isoladamente. Não pular para a etapa seguinte com
a anterior incompleta.

1. **Esqueleto e infra** ? Fastify, env validado, migrations, docker-compose,
   webhook da Evolution recebendo e respondendo eco. Valida a integração ponta a
   ponta antes de qualquer IA.
2. **Fila, dedupe e lock** ? processamento assíncrono com retry. Estrutura em que
   todo o resto vai se apoiar.
3. **Debounce e estado da conversa** ? agrupamento, máquina de estados, guards
   anti-loop.
4. **Camada de IA e triagem** ? interface de provedor, tool use, decisão entre
   FAQ e ticket.
5. **Agente de FAQ** ? resposta com base de conhecimento e MD de contexto.
6. **Agente de ticket + Jira** ? coleta guiada, confirmação, criação, anexos.
7. **Mídia** ? whisper.cpp + ffmpeg para áudio, imagens para o modelo e para o
   chamado.
8. **Handoff humano** ? detecção de `fromMe` e pausa.
9. **Acompanhamento** ? webhook do Jira e consulta de status.
10. **Operação** ? healthcheck, página de QR, alertas, retenção de dados.
11. **Empacotamento** ? README, fixtures, `.example`, LICENSE.

---

## 13. Decisões descartadas (não reabrir)

- **Vercel / serverless** ? uso comercial proibido no Hobby, limite de corpo de
  4,5 MB, cron diário, incompatível com whisper local
- **Oracle Cloud Free Tier** ? instâncias ociosas podem ser recuperadas (CPU,
  rede e memória abaixo de 20% por 7 dias é exatamente o perfil deste bot);
  desnecessário, já que o servidor da empresa hospeda tudo
- **Neon** ? substituído por Supabase (painel web ajuda a depurar conversas)
- **API de transcrição paga** ? whisper local evita custo, chave extra e envio
  de áudio a terceiros
- **n8n / low-code** ? a lógica de decisão fica complexa demais para fluxo
  visual, e código é mais fácil de versionar e testar
- **Git submodule para o MD de contexto** ? busca por URL raw com cache é mais
  simples e desacoplada
- **Interface de transcrição com múltiplas implementações** ? só existe whisper
  local; abstrair agora violaria a regra de KISS da seção 3