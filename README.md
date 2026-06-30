# Portal North

Aplicacao Next.js do Portal North para clientes, com rotas por slug, persistencia de briefing no Supabase e deploy na Vercel.

## Stack

- Next.js 15 App Router
- React 19
- TypeScript strict
- Zod
- Supabase REST via Edge Route Handlers
- Vercel Edge Runtime nas APIs
- CSS global com paleta e tipografia North

## URLs

- Producao: `https://north-portal-navy.vercel.app`
- Slug inicial: `/north`
- Projeto Vercel: `north-portal`
- Supabase Project ID: `svkogegypdqquzlfzaor`
- Supabase URL: `https://svkogegypdqquzlfzaor.supabase.co`

## Variaveis de ambiente

Crie as variaveis abaixo em Production, Preview e Development na Vercel:

```txt
NEXT_PUBLIC_SUPABASE_URL=https://svkogegypdqquzlfzaor.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=
NORTH_ADMIN_TOKEN=
```

Nao commitar `.env`, `.env.local`, service role keys ou tokens administrativos.

## Rotas

- `GET /api/client/[slug]`: carrega cliente, briefing, links e resultados.
- `PATCH /api/client/[slug]/briefing`: salva o objeto completo de respostas do briefing.
- `PATCH /api/admin/client/[slug]`: atualizacao administrativa protegida por `Authorization: Bearer <NORTH_ADMIN_TOKEN>`.
- `/`: redireciona para `/north`.
- `/[slug]`: portal do cliente.

## Supabase

Tabelas utilizadas:

- `clients`
- `briefing_answers`
- `client_drive_links`
- `client_results`

Migration aplicada:

- `supabase/migrations/20260624000000_harden_client_portal.sql`

A migration habilita RLS, remove politicas publicas de escrita e mantem leitura publica apenas dos dados de clientes ativos.

## Desenvolvimento

Instale dependencias:

```bash
npm install
```

Rode localmente:

```bash
npm run dev
```

Validacoes:

```bash
npm run lint
npm run typecheck
npm run build
```

## Administracao

Exemplo de atualizacao administrativa:

```bash
curl -X PATCH \
  "https://north-portal-navy.vercel.app/api/admin/client/north" \
  -H "Authorization: Bearer $NORTH_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "brandUrl": "https://drive.google.com/...",
    "productsUrl": "https://drive.google.com/...",
    "uploadsUrl": "https://drive.google.com/..."
  }'
```

Tambem existem scripts auxiliares:

```bash
npm run seed:client -- north "ADM NORTH"
npm run update:client -- north '{"brandUrl":"https://drive.google.com/..."}'
```

Use `PORTAL_BASE_URL` para apontar os scripts para producao ou preview.

## Estado atual

O deploy compila e a pagina `/north` responde. Para a API funcionar em producao, configure as variaveis protegidas na Vercel. Sem `SUPABASE_SERVICE_ROLE_KEY`, `GET /api/client/north` retorna `503`.
