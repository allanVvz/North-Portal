-- Responsável vinculado a conta real, aditivo ao texto livre já existente em
-- tasks.assignee (mantido para freelancers/nomes históricos sem login). Uma
-- task pode ter 0, 1 ou N linhas aqui; a leitura em código mescla isso com o
-- texto livre remanescente (ver lib/assignees.ts:mergeAssigneeDisplay). Sem
-- tabela de histórico, mesma filosofia já adotada para reviewer_id/approver_id
-- (mutable, no audit trail, by product decision).
create table if not exists public.task_assignees (
  task_id uuid not null references public.tasks(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (task_id, profile_id)
);
create index if not exists task_assignees_profile_id_idx on public.task_assignees (profile_id);

alter table public.task_assignees enable row level security;

create policy "task_assignees admin all" on public.task_assignees
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Client sees only vínculos of tasks it can already read (mirrors "tasks
-- client read visible" from 20260706000004).
create policy "task_assignees client read visible" on public.task_assignees
  for select to authenticated
  using (
    exists (
      select 1 from public.tasks t
      where t.id = task_assignees.task_id
        and t.client_id = public.current_client_id()
        and (t.client_visible = true or t.status in ('aprovacao', 'aprovado', 'concluido'))
    )
  );
