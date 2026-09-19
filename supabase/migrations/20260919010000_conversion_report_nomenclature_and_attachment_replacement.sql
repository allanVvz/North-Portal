-- Conversion report nomenclature and safe replacement of generated attachment
-- comments.  This migration is additive: historical payload markers and
-- comment ids remain readable, while new writes use the conversion vocabulary.

begin;

-- Active configuration is operational state, not a historical artifact: move
-- it to the conversion vocabulary atomically with its validation contract.
-- The earlier migration owns these function bodies; deriving the replacement
-- from the installed definition keeps this migration compatible with every
-- already-migrated database without duplicating a long security-sensitive RPC.
alter table public.automation_configs
  drop constraint if exists automation_configs_automation_key_check;

do $$
declare
  function_sql text;
begin
  select pg_get_functiondef('public.automation_dependency_is_valid()'::regprocedure)
    into function_sql;
  execute replace(function_sql, '''relatorio_vendas''', '''relatorio_conversao''');

  select pg_get_functiondef(
    'public.create_automation_config_with_dependency(text,uuid,text,boolean,text[],uuid)'::regprocedure
  ) into function_sql;
  execute replace(function_sql, '''relatorio_vendas''', '''relatorio_conversao''');
end
$$;

update public.automation_configs
   set automation_key = 'relatorio_conversao'
 where automation_key = 'relatorio_vendas';

alter table public.automation_configs
  add constraint automation_configs_automation_key_check
  check (automation_key in (
    'relatorio_trafego_semanal', 'provisionar_card_metricas',
    'coleta_metrica_cliente', 'relatorio_conversao'
  ));

-- Keep the new marker alongside old payloads.  No backfill is performed here:
-- production payloads are historical audit data and must not be rewritten.
comment on column public.tasks.payload is
  'Report markers use conversion_report_generated_at for new conversion reports; sales_report_generated_at is retained for historical compatibility.';

alter table public.conversion_reports
  drop constraint if exists conversion_reports_status_check;
alter table public.conversion_reports
  add constraint conversion_reports_status_check
  check (status in ('generated', 'finalized', 'superseded'));

create index if not exists conversion_reports_current_idx
  on public.conversion_reports (feedback_task_id, generated_at desc)
  where status <> 'superseded';

create table if not exists public.report_attachment_replacements (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  report_kind text not null check (report_kind in ('ads', 'conversion')),
  previous_comment_id text,
  previous_comment jsonb,
  replacement_comment_id text not null,
  replacement_comment jsonb not null,
  replaced_at timestamptz not null default now(),
  unique (task_id, report_kind, replacement_comment_id)
);

alter table public.report_attachment_replacements enable row level security;
drop policy if exists "report attachment replacements admin all" on public.report_attachment_replacements;
create policy "report attachment replacements admin all"
  on public.report_attachment_replacements for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Remove only the last generated attachment comment for this report kind, then
-- append the replacement under the row lock. Human comments and other payload
-- keys are never copied from a stale read and are therefore preserved.
create or replace function public.replace_automatic_report_attachment(
  p_task_id uuid,
  p_report_kind text,
  p_comment_id text,
  p_comment_text text,
  p_comment_author text default 'Northia'
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_task public.tasks;
  comments jsonb;
  kept jsonb := '[]'::jsonb;
  old_comment jsonb;
  old_id text;
  item jsonb;
  ord bigint;
  old_ord bigint := 0;
  new_comment jsonb;
  inserted boolean := false;
begin
  if p_report_kind not in ('ads', 'conversion') then
    raise exception 'Tipo de relatório inválido';
  end if;
  if nullif(btrim(p_comment_id), '') is null or length(p_comment_id) > 128 then
    raise exception 'Identificador de comentário inválido';
  end if;
  if nullif(btrim(p_comment_text), '') is null or length(p_comment_text) > 4000 then
    raise exception 'Comentário inválido';
  end if;

  select * into current_task from public.tasks where id = p_task_id for update;
  if current_task.id is null then return null; end if;

  comments := coalesce(current_task.payload->'comments', '[]'::jsonb);
  if not (comments @> jsonb_build_array(jsonb_build_object('id', p_comment_id))) then
    for item, ord in
      select value, ordinality from jsonb_array_elements(comments) with ordinality
    loop
      if (coalesce(item->>'id', '') like 'ads-report:%' or coalesce(item->>'id', '') like 'ads-revision:%')
         and p_report_kind = 'ads'
         and ord > old_ord then
        old_comment := item; old_id := item->>'id'; old_ord := ord;
      elsif (coalesce(item->>'id', '') like 'conversion-report:%' or coalesce(item->>'id', '') like 'sales-report:%')
         and p_report_kind = 'conversion'
         and ord > old_ord then
        old_comment := item; old_id := item->>'id'; old_ord := ord;
      end if;
    end loop;

    for item, ord in
      select value, ordinality from jsonb_array_elements(comments) with ordinality
    loop
      if ord <> old_ord then kept := kept || jsonb_build_array(item); end if;
    end loop;

    new_comment := jsonb_strip_nulls(jsonb_build_object(
      'id', p_comment_id,
      'author', coalesce(nullif(btrim(p_comment_author), ''), 'Northia'),
      'text', btrim(p_comment_text),
      'at', to_char(clock_timestamp() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ));
    kept := kept || jsonb_build_array(new_comment);
    inserted := true;

    insert into public.report_attachment_replacements
      (task_id, report_kind, previous_comment_id, previous_comment,
       replacement_comment_id, replacement_comment)
    values (p_task_id, p_report_kind, old_id, old_comment, p_comment_id, new_comment)
    on conflict (task_id, report_kind, replacement_comment_id) do nothing;

    update public.tasks
       set payload = jsonb_set(coalesce(payload, '{}'::jsonb), '{comments}', kept, true),
           updated_at = now()
     where id = p_task_id;
  end if;

  select * into current_task from public.tasks where id = p_task_id;
  return jsonb_build_object('inserted', inserted, 'task', to_jsonb(current_task),
    'replaced_comment_id', old_id);
end
$$;

revoke all on function public.replace_automatic_report_attachment(uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.replace_automatic_report_attachment(uuid, text, text, text, text)
  to service_role;

commit;
