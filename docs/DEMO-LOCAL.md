# Subir a demonstração local (Next local + Supabase na nuvem)

O app roda **localmente** (`localhost:3000`) e fala com um **projeto Supabase na nuvem**. Auth por sessão (Supabase Auth): login de **admin** e de **cliente**.

## 1. Variáveis de ambiente — `.env.local`
Crie `.env.local` na raiz com as chaves do **projeto Supabase escolhido** (Project Settings → API):
```txt
NEXT_PUBLIC_SUPABASE_URL=https://SEU-REF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon/publishable key>
SUPABASE_SERVICE_ROLE_KEY=<service_role key — server only>
```

## 2. Aplicar as migrations (ordem por nome de arquivo)
`supabase/migrations/`:
1. `20260623120000_base_schema.sql` — 4 tabelas (idempotente)
2. `20260624000000_harden_client_portal.sql` — hardening antigo (mantido)
3. `20260703000001_auth_profiles.sql` — profiles + enum + triggers
4. `20260703000002_rls_by_role.sql` — RLS por role/posse
5. `20260703000003_tasks.sql` — tabela tasks + RLS

**Como aplicar** (uma das opções):
- **Supabase Studio → SQL Editor:** colar e rodar cada arquivo na ordem.
- **CLI:** `npx supabase link --project-ref SEU-REF` e `npx supabase db push`.

## 3. Seed dos clientes validados
Rodar `supabase/seed.sql` (SQL Editor). Cria clientes `north`, `karpinski`, `baita-conveniencia` + resultados/links/briefing + tarefas de exemplo.

## 4. Criar os usuários de login (admin + cliente)
Precisa das mesmas envs no shell (ou no `.env.local`, que o script lê):
```bash
npm run create:user -- admin@north.com "SenhaForte123!" admin
npm run create:user -- cliente@karpinski.com "SenhaForte123!" client karpinski
```
O trigger `handle_new_user` cria o profile com o role/`client_id` corretos.

> **Auth → URL Configuration** no Supabase: adicionar `http://localhost:3000` (e o domínio Vercel) em **Site URL / Redirect URLs**.

## 5. Rodar
```bash
npm install
npm run dev
```
- Acesse `http://localhost:3000` → redireciona para `/login`.
- **Admin** (`admin@north.com`) → `/admin` (gestão de clientes).
- **Cliente** (`cliente@karpinski.com`) → `/karpinski` (portal, briefing por-pergunta).
- Cliente tentando abrir `/baita-conveniencia` → redirecionado ao próprio slug (RLS + middleware).

## Deploy Vercel (mesma base)
- Definir as 3 envs em **Production/Preview/Development**.
- Adicionar o domínio Vercel nas Redirect URLs do Auth.
- Migrations já ficam prontas para o mesmo projeto (ou para Postgres local via `npx supabase start`, quando quiser dev offline).
