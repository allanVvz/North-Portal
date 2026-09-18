-- Smoke da migration 20260918150000_atomic_task_comments.sql.
--
-- Roda tudo dentro de uma transação e termina em ROLLBACK: não deixa dado.
-- Executar como service role / postgres (as duas funções precisam de acesso à
-- linha), depois de aplicar a migration:
--
--   ! psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/postflight/20260918_atomic_task_comments_smoke.sql
--
-- Cada `do $$` levanta exceção se a expectativa falhar.

begin;

do $$
declare
  task_id uuid;
  author uuid;
  result jsonb;
  comments jsonb;
begin
  select id into task_id from public.tasks limit 1;
  select id into author from public.profiles limit 1;
  if task_id is null or author is null then
    raise exception 'smoke precisa de ao menos uma tarefa e um perfil';
  end if;
  update public.tasks set payload = '{}'::jsonb where id = task_id;

  -- 1. comentário humano: grava uma vez; o mesmo comment_id não duplica.
  result := public.append_task_comment_idempotent(task_id, author, 'primeiro', 'smoke-comment-0001');
  if (result->>'inserted')::boolean is not true then raise exception '1a: esperava inserted=true'; end if;
  result := public.append_task_comment_idempotent(task_id, author, 'primeiro', 'smoke-comment-0001');
  if (result->>'inserted')::boolean is not false then raise exception '1b: esperava inserted=false no retry'; end if;
  select payload->'comments' into comments from public.tasks where id = task_id;
  if jsonb_array_length(comments) <> 1 then raise exception '1c: esperava 1 comentário, achei %', jsonb_array_length(comments); end if;

  -- 2. automação: comentário + patch preservam o comentário humano.
  result := public.automation_task_payload_update(
    task_id, 'Relatório gerado', 'smoke-auto-0001', 'Automação',
    '{"marker":"x"}'::jsonb, '{}'::text[]
  );
  if (result->>'inserted')::boolean is not true then raise exception '2a: esperava inserted=true'; end if;
  select payload->'comments' into comments from public.tasks where id = task_id;
  if jsonb_array_length(comments) <> 2 then raise exception '2b: esperava 2 comentários, achei %', jsonb_array_length(comments); end if;
  if comments->0->>'text' <> 'primeiro' then raise exception '2c: comentário humano foi perdido'; end if;

  -- 3. mesma ação da automação repetida: sem comentário novo, patch continua.
  result := public.automation_task_payload_update(
    task_id, 'Relatório gerado', 'smoke-auto-0001', 'Automação',
    '{"marker":"y"}'::jsonb, '{}'::text[]
  );
  if (result->>'inserted')::boolean is not false then raise exception '3a: esperava inserted=false'; end if;
  select payload->'comments' into comments from public.tasks where id = task_id;
  if jsonb_array_length(comments) <> 2 then raise exception '3b: retry duplicou o comentário'; end if;

  -- 4. remove só as chaves pedidas; comments é intocável.
  perform public.automation_task_payload_update(task_id, null, null, 'Automação', '{}'::jsonb, array['marker']);
  if (select payload ? 'marker' from public.tasks where id = task_id) then raise exception '4a: marker não foi removido'; end if;
  if jsonb_array_length((select payload->'comments' from public.tasks where id = task_id)) <> 2 then
    raise exception '4b: remoção mexeu nos comentários';
  end if;
  begin
    perform public.automation_task_payload_update(task_id, null, null, 'Automação', '{"comments":[]}'::jsonb, '{}'::text[]);
    raise exception '4c: patch em comments deveria ser recusado';
  exception when raise_exception then
    if sqlerrm like '4c:%' then raise; end if;
  end;

  raise notice 'atomic_task_comments smoke: ok';
end
$$;

rollback;
