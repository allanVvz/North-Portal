# Dúvidas técnicas a resolver antes do deploy

> **Uso:** checklist de bloqueios. Cada item tem **contexto**, a **pergunta**, o **impacto** e a **recomendação padrão** (o que fazemos se não houver resposta). Marque `[x]` quando decidido e registre a resposta na coluna.
> Referência: `docs/REQUISITOS-PORTAL-NORTH.md`.

## 🔴 Bloqueadores (não fazer deploy sem responder)

### 1. Qual é o projeto Supabase de produção?
- **Contexto:** `README.md` e `.env.example` apontam `svkogegypdqquzlfzaor` (`https://svkogegypdqquzlfzaor.supabase.co`), mas há registro de que **produção usa um projeto NOVO**, diferente do que está nos docs.
- **Pergunta:** qual o **project ref**, **URL**, **publishable/anon key** e **service_role key** corretos de produção? O schema (4 tabelas + migration de RLS) já foi aplicado nesse projeto?
- **Impacto:** deploy pode gravar/ler do banco errado; APIs retornam 503 sem as keys certas.
- **Recomendação padrão:** confirmar no painel Supabase, atualizar `README.md` + variáveis da Vercel, e rodar a migration + DDL base (§4.6 do requisitos) no projeto correto.
- **Resposta:** _______________

### 2. Como o cliente autentica para **escrever** o briefing?
- **Contexto:** `PATCH /api/client/[slug]/briefing` é **público** hoje. Qualquer um com o slug de um cliente ativo pode sobrescrever o briefing (destrutivo — não há histórico).
- **Pergunta:** MVP aceita esse risco (slugs não-adivinháveis + rate limit) ou exigimos autenticação por cliente (senha/PIN/link mágico) já no deploy?
- **Impacto:** segurança e integridade dos dados do cliente.
- **Recomendação padrão:** para demo/MVP fechado, aceitar risco **com** rate limit + slug longo/aleatório; para produção com clientes reais, exigir PIN por cliente antes de habilitar escrita.
- **Resposta:** _______________

### 3. Variáveis de ambiente na Vercel
- **Pergunta:** as 4 variáveis estão configuradas em **Production, Preview e Development**?
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY` (server-only — nunca `NEXT_PUBLIC_`)
  - `NORTH_ADMIN_TOKEN` (segredo forte, ex.: 32+ bytes aleatórios)
- **Impacto:** sem `SUPABASE_SERVICE_ROLE_KEY`, `GET /api/client/north` retorna **503**.
- **Recomendação padrão:** gerar `NORTH_ADMIN_TOKEN` com `openssl rand -hex 32`; validar as 4 antes de promover.
- **Resposta:** _______________

### 4. Cliente inicial e dados existem no banco?
- **Contexto:** não há endpoint de criação; `seed-client.mjs` faz PATCH assumindo cliente existente.
- **Pergunta:** o registro `clients(slug='north')` + os 3 filhos (`briefing_answers`, `client_drive_links`, `client_results`) já existem no projeto de produção? Quais outros slugs entram no deploy?
- **Impacto:** `/north` dá 404 se o registro não existir.
- **Recomendação padrão:** inserir manualmente via SQL/Studio (usar DDL/§4.6 + `insert`s) antes do deploy, ou criar o `POST /api/admin/client`.
- **Resposta:** _______________

## 🟠 Importantes (resolver antes de tráfego real)

### 5. Domínio de produção
- **Pergunta:** fica em `north-portal-navy.vercel.app` ou domínio próprio (ex.: `portal.north.com.br`)? Precisa configurar DNS/SSL?
- **Recomendação padrão:** usar o domínio Vercel para demo; domínio próprio antes de divulgar a clientes.
- **Resposta:** _______________

### 6. Pausa do Supabase free tier por inatividade
- **Contexto:** projetos free podem **pausar após ~7 dias sem uso**. Ruim para demos esporádicas.
- **Pergunta:** aceitamos "acordar" manualmente antes de cada demo, ou configuramos keep-alive (cron 1×/dia)? O plano permite keep-alive?
- **Recomendação padrão:** Vercel Cron/GitHub Action com `GET /api/client/north` diário; se a política proibir, acordar manualmente antes da demo.
- **Resposta:** _______________

### 7. Validação de URLs (HTTPS)
- **Contexto:** o admin só valida tamanho das URLs, não o esquema.
- **Pergunta:** ligamos validação `https://` obrigatória agora?
- **Recomendação padrão:** sim — adicionar `z.string().url()` + checagem de protocolo no `adminPatchSchema`.
- **Resposta:** _______________

### 8. Rate limiting
- **Pergunta:** adotamos rate limit nas Edge Functions no deploy inicial? Qual serviço (Upstash free / lógica própria)?
- **Recomendação padrão:** Upstash Ratelimit (free) por IP+slug nas rotas de escrita.
- **Resposta:** _______________

## 🟡 Recomendadas (higiene / evitar dívida)

### 9. `PortalPremium.tsx` — manter ou remover?
- **Recomendação padrão:** remover (código morto, não importado) a menos que seja a próxima UI.
- **Resposta:** _______________

### 10. Formato do briefing (por card vs por pergunta)
- **Contexto:** divergência design (Figma sessão 17: uma caixa por pergunta) × código (uma resposta por card).
- **Pergunta:** mudamos o modelo de dados para chave por pergunta ou o design é apenas visual sobre a mesma resposta?
- **Recomendação padrão:** manter por-card no MVP; migrar depois se o negócio exigir granularidade por pergunta.
- **Resposta:** _______________

### 11. `.git-alt/` e `.npm-cache/` no working tree
- **Pergunta:** `.git-alt/` é um repositório git órfão? Pode apagar? (Ambos estão no `.gitignore`, mas poluem o diretório.)
- **Recomendação padrão:** confirmar que não são versionados e apagar do disco.
- **Resposta:** _______________

### 12. Backups
- **Pergunta:** free tier tem backup automático suficiente? Precisamos de `pg_dump` agendado?
- **Recomendação padrão:** exportar `pg_dump` semanal (GitHub Action) já no MVP — dados de briefing não têm histórico e sobrescrita é destrutiva.
- **Resposta:** _______________

---

## Comandos de verificação rápida (pré-deploy)

```bash
# 1. Build/typecheck/lint limpos
npm run typecheck && npm run lint && npm run build

# 2. Sanidade da API (após configurar env local em .env.local)
npm run dev
#   GET portal:
curl -s http://localhost:3000/api/client/north | jq .
#   PATCH admin (precisa de NORTH_ADMIN_TOKEN):
curl -s -X PATCH http://localhost:3000/api/admin/client/north \
  -H "Authorization: Bearer $NORTH_ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"ADM NORTH","is_active":true}'

# 3. Gerar token admin forte
openssl rand -hex 32
```
