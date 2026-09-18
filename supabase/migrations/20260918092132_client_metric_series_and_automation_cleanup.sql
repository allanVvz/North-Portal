begin;

-- Canonical, platform-aware time series. task_metrics remains the card-facing
-- aggregate; this table is the durable reference future agents query.
create table if not exists public.client_metric_series (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  platform text not null,
  metric_key text not null,
  period_from date not null,
  period_to date not null,
  value numeric not null check (value >= 0),
  source_task_id uuid references public.tasks(id) on delete set null,
  source_comment_at text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_metric_series_period_valid check (period_from <= period_to),
  unique (client_id, platform, metric_key, period_to)
);
create index if not exists client_metric_series_lookup_idx
  on public.client_metric_series (client_id, platform, metric_key, period_to desc);
alter table public.client_metric_series enable row level security;
drop policy if exists "client metric series admin all" on public.client_metric_series;
create policy "client metric series admin all" on public.client_metric_series
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
grant select, insert, update, delete on public.client_metric_series to authenticated, service_role;

-- Archive the explicitly audited empty test occurrences before deletion. This
-- is the rollback source; no historical or generated card is in this set.
create table if not exists public.automation_cleanup_archive_20260918 (
  id uuid primary key default gen_random_uuid(),
  archived_at timestamptz not null default now(),
  task jsonb not null,
  links jsonb not null default '[]'::jsonb,
  assignees jsonb not null default '[]'::jsonb
);
insert into public.automation_cleanup_archive_20260918(task, links, assignees)
select to_jsonb(task), coalesce(link_rows.payload, '[]'::jsonb), coalesce(assignee_rows.payload, '[]'::jsonb)
from public.tasks task
left join lateral (
  select jsonb_agg(to_jsonb(task_link)) as payload
  from public.task_links task_link
  where task_link.parent_id = task.id or task_link.child_id = task.id
) link_rows on true
left join lateral (
  select jsonb_agg(to_jsonb(task_assignee)) as payload
  from public.task_assignees task_assignee
  where task_assignee.task_id = task.id
) assignee_rows on true
where task.id = any (array[
  '3ef6940d-43f6-5fe7-a8a4-1fcf6b7c197d'::uuid,
  'b9ce324a-ad29-5103-8570-0e82ac83138d'::uuid,
  'b38f6e7f-b5cd-5f2c-91cb-c4546418aa81'::uuid,
  '2d42ae29-2e88-54b5-9520-ceefd8222e4f'::uuid,
  '9d7ea144-6976-531d-85dd-16d8887e8787'::uuid,
  '0c2e1722-33fd-5fac-9a49-7aba23d97569'::uuid
])
and not exists (select 1 from public.automation_cleanup_archive_20260918 archive where archive.task->>'id' = task.id::text);

delete from public.tasks
where id = any (array[
  '2d42ae29-2e88-54b5-9520-ceefd8222e4f'::uuid,
  '9d7ea144-6976-531d-85dd-16d8887e8787'::uuid,
  '0c2e1722-33fd-5fac-9a49-7aba23d97569'::uuid,
  '3ef6940d-43f6-5fe7-a8a4-1fcf6b7c197d'::uuid,
  'b9ce324a-ad29-5103-8570-0e82ac83138d'::uuid,
  'b38f6e7f-b5cd-5f2c-91cb-c4546418aa81'::uuid
]);

-- Convert every recognized human alias into its real account link.
insert into public.task_assignees(task_id, profile_id)
select distinct task.id, profile.id
from public.tasks task
cross join lateral unnest(string_to_array(coalesce(task.assignee, ''), ',')) raw(name)
join public.profiles profile on lower(profile.full_name) = case lower(trim(raw.name))
  when 'alisson rosa' then 'alisson'
  when 'luiza camargo' then 'luiza'
  else lower(trim(raw.name))
end
where profile.role = 'admin'
on conflict do nothing;

-- Free text is only for the non-human agent after account links are created.
update public.tasks task
set assignee = (
  select nullif(string_agg(distinct value, ', ' order by value), '') as value
  from (
    select case
      when lower(trim(raw.name)) in ('allan','alisson','alisson rosa','cintia','luiza','luiza camargo') then null
      when lower(trim(raw.name)) in ('north','northia','north ai','northai') then 'North Ai'
      else nullif(trim(raw.name), '')
    end as value
    from unnest(string_to_array(coalesce(task.assignee, ''), ',')) raw(name)
  ) names
  where value is not null
);

-- Every report automation is executed by the agent; only Feedback routes to
-- the two traffic managers at runtime.
update public.tasks
set assignee = 'North Ai'
where kind = 'automacao'
   or subtype in ('relatorio_anuncios', 'relatorio_conversao')
   or (title = 'Relatório de anúncios' and recurrence_cadence is not null);

-- Nos dois testes auditados, Luiza é a responsável humana da entrega-pai;
-- North Ai permanece como executor no texto do card. A relação estruturada
-- permite que a regra genérica de autorrevisão compare a revisora real.
insert into public.task_assignees(task_id, profile_id)
select task_id, 'c87b2f9b-7c23-4539-945a-985ccddfa856'::uuid
from (values
  ('2b4f7516-8826-5f34-8c4d-cc49f248c076'::uuid),
  ('a363931c-038c-5512-b246-1a05c0b83389'::uuid)
) test_parent(task_id)
on conflict do nothing;

-- Regular cadence: all five report molds run on Monday. The two audited test
-- cycles are the only temporary exceptions for 18/09/2026.
update public.tasks
set recurrence_cadence = 'semanal', recurrence_weekdays = array[1]::smallint[], due_date = date '2026-09-21', start_date = date '2026-09-21', end_date = greatest(coalesce(end_date, date '2026-09-21'), date '2026-09-21')
where id in ('36cfd1f1-aa59-5581-9186-bb7460853e7d'::uuid, '57cca525-93a8-5c2f-9ff4-813a72d306f7'::uuid, '8d91d4c4-3d26-56c9-953e-276e512503ec'::uuid)
   or id in ('96c6a5ea-af24-49f3-aa10-b6c34f33104c'::uuid, 'ab69859e-3a80-4bb6-8c68-3b5917effcfe'::uuid, 'f8362c98-9832-4eeb-a549-bffd7400ad23'::uuid);

update public.tasks
set due_date = date '2026-09-18', start_date = date '2026-09-18', end_date = date '2026-09-18',
    payload = jsonb_set(payload, '{occurrence_date}', to_jsonb('2026-09-18'::text), true)
where id in ('2b4f7516-8826-5f34-8c4d-cc49f248c076'::uuid, 'a363931c-038c-5512-b246-1a05c0b83389'::uuid,
             '8aeece8d-2134-5368-a2f8-f274c39155ad'::uuid, '679bef4e-e858-5e3e-8149-0b33ed2c5b30'::uuid);

update public.tasks
set due_date = date '2026-09-18', start_date = date '2026-09-18', end_date = greatest(coalesce(end_date, date '2026-09-18'), date '2026-09-18')
where id in ('15d5096d-fce7-54b2-9960-f302ec0ccd0c'::uuid, '0e41cb7a-e4a2-5a22-89bd-89ca7e89e807'::uuid,
             '10c3d85c-6ed1-4883-94ea-d8d41cddb88a'::uuid, 'c499448b-bd0a-4bac-b8fc-bfe73339a473'::uuid);

commit;
