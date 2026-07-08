-- Lets a client-role session update a task's status directly, but only when
-- it is currently in the approval gate, visible to them, and they are the
-- specific person registered to review it (tasks.reviewer_id = their own
-- profile id) — i.e. only the designated approver can act on that card, even
-- though every account linked to the client can see it (existing SELECT
-- policy "tasks client read visible" already covers that).
create policy "tasks client approve own" on public.tasks
  for update to authenticated
  using (
    client_visible = true
    and client_id = public.current_client_id()
    and status = 'aprovacao'
    and reviewer_id = auth.uid()
  )
  with check (
    client_id = public.current_client_id()
  );
