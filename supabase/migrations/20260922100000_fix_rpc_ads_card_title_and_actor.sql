-- Dois defeitos no card de anúncios que `create_automation_config_with_dependency`
-- cria quando um cliente é cadastrado sem automação de anúncios prévia:
--
-- 1. TÍTULO COM MOJIBAKE. O literal na migração 20260917120000 foi gravado como
--    'RelatÃ³rio de anÃºncios' — UTF-8 lido como Latin-1. O card nasceria com esse
--    texto visível no quadro e no relatório.
-- 2. ATOR ERRADO. O assignee sai como 'Northia', mas o ator das automações é
--    'North Ai' (AUTOMATION_ASSIGNEE em lib/automations/taskAccess.ts), que é o
--    que todos os moldes existentes usam. 'Northia' é o valor de
--    `payload.automation_actor`, outra coisa.
--
-- Nenhum cliente passou por este caminho ainda: os cinco moldes em produção foram
-- criados em 21/08, antes desta RPC existir. FALKE ESTÉTICA seria o primeiro — e
-- é por isso que o conserto vem antes do cadastro.
--
-- A substituição é derivada da definição INSTALADA (mesmo padrão de
-- 20260919010000), não de uma cópia do corpo aqui: assim a migração vale para
-- qualquer banco já migrado, sem duplicar uma função longa e sensível.

do $$
declare
  function_sql text;
  before_count int;
begin
  select pg_get_functiondef(
    'public.create_automation_config_with_dependency(text,uuid,text,boolean,text[],uuid)'::regprocedure
  ) into function_sql;

  -- Falha alto se o alvo não estiver lá: melhor a migração parar do que "corrigir"
  -- silenciosamente uma função que já mudou de forma.
  select count(*) into before_count
  from regexp_matches(function_sql, 'RelatÃ³rio de anÃºncios', 'g');
  if before_count <> 1 then
    raise exception 'Esperava 1 título com mojibake, encontrei %. A função mudou — revise antes de aplicar.', before_count;
  end if;

  function_sql := replace(function_sql, 'RelatÃ³rio de anÃºncios', 'Relatório de anúncios');
  function_sql := replace(function_sql, ', ''Northia'', coalesce(', ', ''North Ai'', coalesce(');
  execute function_sql;
end
$$;

-- Corrige também o que já existir, se alguém tiver cadastrado por este caminho
-- entre a migração de 17/09 e esta. Sem linhas afetadas hoje; existe para o caso
-- de a correção chegar depois de um cadastro.
update public.tasks
   set title = 'Relatório de anúncios'
 where title = 'RelatÃ³rio de anÃºncios';

update public.tasks
   set assignee = 'North Ai'
 where assignee = 'Northia'
   and kind = 'operacional'
   and subtype = 'relatorio_anuncios';
