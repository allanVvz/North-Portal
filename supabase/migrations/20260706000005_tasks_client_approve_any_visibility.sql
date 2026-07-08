-- The approve/ajustes action should follow the same rule as reading: any
-- card in "aprovacao" is the client's to act on (as long as they're the
-- designated reviewer) — `client_visible` no longer gates this stage.
drop policy if exists "tasks client approve own" on public.tasks;
create policy "tasks client approve own" on public.tasks
  for update to authenticated
  using (
    client_id = public.current_client_id()
    and status = 'aprovacao'
    and reviewer_id = auth.uid()
  )
  with check (
    client_id = public.current_client_id()
  );
