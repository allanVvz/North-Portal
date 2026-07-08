-- Split the single reviewer_id into two explicit roles: reviewer_id is now the
-- internal REVISOR (admin, Revisão stage only) and approver_id is the client
-- APROVADOR (Aprovação stage). "Sem revisor" / "Sem aprovação" (null) skip that
-- stage. The client-approval RLS now keys off approver_id (+ gerente escalation).

alter table public.tasks add column approver_id uuid references public.profiles(id) on delete set null;

-- Migrate existing data: a reviewer_id pointing at a CLIENT profile was really
-- the aprovador — move it to approver_id and clear reviewer_id (which is
-- admin-only now).
update public.tasks t set approver_id = t.reviewer_id
  where t.reviewer_id is not null
    and exists (select 1 from public.profiles p where p.id = t.reviewer_id and p.role = 'client');
update public.tasks t set reviewer_id = null
  where t.reviewer_id is not null
    and exists (select 1 from public.profiles p where p.id = t.approver_id and p.id = t.reviewer_id);

-- Client approval keys off approver_id now (plus gerente escalation over the
-- account's usuario approvers).
drop policy if exists "tasks client approve own" on public.tasks;
create policy "tasks client approve own" on public.tasks
  for update to authenticated
  using (
    client_id = public.current_client_id()
    and status = 'aprovacao'
    and (approver_id = auth.uid() or public.is_manager())
  )
  with check (client_id = public.current_client_id());
