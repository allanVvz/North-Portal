-- Retroactive cleanup: a client with Admin off for a stage shouldn't have
-- cards resting in that stage's column (checked now empty at time of writing,
-- kept for correctness/safety going forward). "Outros" (no client) is left
-- alone — there's no admin flag concept for unassigned tasks.
update public.tasks t
set status = 'em_producao'
where t.client_id is not null
  and t.status = 'revisao'
  and coalesce((select f.revisao_admin from public.client_flow_flags f where f.client_id = t.client_id), false) = false;

update public.tasks t
set status = 'em_producao'
where t.client_id is not null
  and t.status = 'aprovacao'
  and coalesce((select f.aprovacao_admin from public.client_flow_flags f where f.client_id = t.client_id), false) = false;

-- The Kanban column visibility is now fully automatic (visible iff at least
-- one card currently sits in that status) — the manual per-client toggle is
-- no longer read or written anywhere in the app.
alter table public.client_flow_flags drop column if exists revisao_kanban;
alter table public.client_flow_flags drop column if exists aprovacao_kanban;
