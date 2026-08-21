-- Automações v2: registro manual, genérico, por card — substitui o modelo v1
-- (config única "da agência" com fan-out automático de cards por cliente
-- elegível). automation_configs ainda tinha 0 linhas em produção quando este
-- ALTER foi escrito, então é seguro simplificar em vez de migrar dado. Ver
-- plan/AUTOMACOES-RELATORIO-TRAFEGO.md "Schema v2 de automation_configs".

alter table public.automation_configs drop constraint automation_configs_check;
alter table public.automation_configs drop constraint automation_configs_scope_check;
alter table public.automation_configs drop constraint automation_configs_recurrence_cadence_check;
alter table public.automation_configs drop constraint automation_configs_client_id_fkey;
alter table public.automation_configs drop constraint automation_configs_parent_task_id_fkey;
alter table public.automation_configs drop constraint automation_configs_template_task_id_fkey;

drop index if exists public.automation_configs_agency_key_idx;
drop index if exists public.automation_configs_client_key_idx;

alter table public.automation_configs
  drop column scope,
  drop column client_id,
  drop column target_kind,
  drop column target_subtype,
  drop column recurrence_cadence,
  drop column recurrence_weekdays,
  drop column recurrence_day_of_month,
  drop column parent_task_id;

alter table public.automation_configs rename column template_task_id to target_task_id;
alter table public.automation_configs alter column target_task_id set not null;
alter table public.automation_configs
  add constraint automation_configs_target_task_id_fkey
  foreign key (target_task_id) references public.tasks(id) on delete cascade;

alter table public.automation_configs add column if not exists last_run_date date;

create unique index automation_configs_target_task_idx
  on public.automation_configs (target_task_id);
