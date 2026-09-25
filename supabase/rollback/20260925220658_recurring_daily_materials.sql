begin;
do $$ begin
  if exists (select 1 from public.automation_configs where automation_key = 'diaria_recorrente') then
    raise exception 'Exporte e reconcilie as configurações de diária antes de reverter';
  end if;
end $$;
drop function if exists public.materialize_recurring_daily(uuid, date, jsonb);
drop index if exists public.automation_configs_daily_target_idx;
alter table public.automation_configs drop constraint if exists automation_configs_daily_config_check;
alter table public.automation_configs drop column if exists daily_config;
alter table public.automation_configs drop constraint if exists automation_configs_automation_key_check;
alter table public.automation_configs add constraint automation_configs_automation_key_check
  check (automation_key in ('relatorio_trafego_semanal', 'provisionar_card_metricas',
                            'coleta_metrica_cliente', 'relatorio_conversao'));
commit;
