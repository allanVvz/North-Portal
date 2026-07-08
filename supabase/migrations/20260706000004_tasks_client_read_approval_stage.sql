-- Conceptual correction: the approval pipeline (Aprovação/Concluído/Publicado)
-- is inherently client-facing — every card that reaches "aprovacao" can be
-- seen by the client, regardless of the `client_visible` flag (which still
-- gates the separate "Plano de Ação" feature for earlier Kanban stages).
drop policy if exists "tasks client read visible" on public.tasks;
create policy "tasks client read visible" on public.tasks
  for select to authenticated
  using (
    client_id = public.current_client_id()
    and (client_visible = true or status in ('aprovacao', 'aprovado', 'concluido'))
  );
