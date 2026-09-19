-- Rollback operacional de 20260919010000.
-- Mantém a tabela de auditoria e os artefatos produzidos (ambos são auditáveis),
-- mas restaura a chave de configuração e as funções para uma aplicação antiga.
-- Execute apenas se o deploy da aplicação precisar ser revertido.

begin;

alter table public.automation_configs
  drop constraint if exists automation_configs_automation_key_check;

do $$
declare
  function_sql text;
begin
  select pg_get_functiondef('public.automation_dependency_is_valid()'::regprocedure)
    into function_sql;
  execute replace(function_sql, '''relatorio_conversao''', '''relatorio_vendas''');

  select pg_get_functiondef(
    'public.create_automation_config_with_dependency(text,uuid,text,boolean,text[],uuid)'::regprocedure
  ) into function_sql;
  execute replace(function_sql, '''relatorio_conversao''', '''relatorio_vendas''');
end
$$;

update public.automation_configs
   set automation_key = 'relatorio_vendas'
 where automation_key = 'relatorio_conversao';

alter table public.automation_configs
  add constraint automation_configs_automation_key_check
  check (automation_key in (
    'relatorio_trafego_semanal', 'provisionar_card_metricas',
    'coleta_metrica_cliente', 'relatorio_vendas'
  ));

commit;
