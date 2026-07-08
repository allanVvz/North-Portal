-- Client documents (contracts, proposals, reports, materials).
-- Admin manages the full list; each client reads only its own (feeds the
-- portal "Documentos" page). Mirrors the is_admin / owns_client RLS model.
-- v1 stores a link (file_url) like the drive links; Supabase Storage is a v2.

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  name text not null,
  doc_type text not null default 'material'
    check (doc_type in ('contrato','proposta','relatorio','material')),
  status text not null default 'enviada'
    check (status in ('enviada','assinado','aguardando_assinatura','publicado','compartilhado')),
  file_url text,
  doc_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists documents_client_idx on public.documents (client_id);

drop trigger if exists set_updated_at on public.documents;
create trigger set_updated_at before update on public.documents
  for each row execute function public.set_updated_at();

alter table public.documents enable row level security;

do $$
declare r record;
begin
  for r in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'documents'
  loop
    execute format('drop policy if exists %I on public.documents', r.policyname);
  end loop;
end$$;

-- client reads its own documents; admin full write
create policy "documents read own" on public.documents
  for select to authenticated using (public.owns_client(client_id));
create policy "documents admin write" on public.documents
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
