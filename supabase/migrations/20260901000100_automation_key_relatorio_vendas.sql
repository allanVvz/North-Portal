-- Automação 2 do fluxo de conversão: chave `relatorio_vendas`.
-- Recria o CHECK de automation_key com o 4º valor (padrão de
-- 20260825140611_metric_collection.sql).

do $$
declare cname text;
begin
  select conname into cname from pg_constraint
   where conrelid = 'public.automation_configs'::regclass and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%automation_key%';
  if cname is not null then
    execute format('alter table public.automation_configs drop constraint %I', cname);
  end if;
end$$;

alter table public.automation_configs
  add constraint automation_configs_automation_key_check
  check (automation_key in (
    'relatorio_trafego_semanal',
    'provisionar_card_metricas',
    'coleta_metrica_cliente',
    'relatorio_vendas'
  ));
