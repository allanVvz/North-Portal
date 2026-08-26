-- Card de coleta de métricas com o cliente.
--
-- Motivo: as métricas de conversão da Meta (leads/compras/mensagens) são
-- esparsas e só de mídia paga — dependem de Pixel/CAPI configurados do lado do
-- cliente. Agendamento, orçamento fechado e venda no balcão nunca chegam pela
-- API. Então a plataforma pergunta: um card recorrente vence, vira pendência no
-- portal do cliente, e o número que ele digita cai em task_metrics com
-- source='cliente'.
--
-- Nenhum cron novo: o tick diário de automations-run-daily já existe.

alter table public.automation_configs
  add column if not exists collect_metric_keys text[];

comment on column public.automation_configs.collect_metric_keys is
  'Chaves de app/admin/metricDefs.ts que este card pede ao cliente. Só usado por automation_key = coleta_metrica_cliente.';

-- O cliente passa a poder gravar as próprias métricas, mas SÓ nos cards que têm
-- uma automação de coleta ativa apontando para eles. Sem isso um cliente poderia
-- reescrever qualquer métrica vinda do Meta/Windsor.
drop policy if exists "task_metrics client collect insert" on public.task_metrics;
drop policy if exists "task_metrics client collect update" on public.task_metrics;

create policy "task_metrics client collect insert" on public.task_metrics
  for insert to authenticated
  with check (
    client_id = public.current_client_id()
    and exists (
      select 1 from public.automation_configs ac
      where ac.target_task_id = task_metrics.task_id
        and ac.automation_key = 'coleta_metrica_cliente'
        and ac.active
    )
  );

create policy "task_metrics client collect update" on public.task_metrics
  for update to authenticated
  using (
    client_id = public.current_client_id()
    and exists (
      select 1 from public.automation_configs ac
      where ac.target_task_id = task_metrics.task_id
        and ac.automation_key = 'coleta_metrica_cliente'
        and ac.active
    )
  )
  with check (client_id = public.current_client_id());

-- O CHECK de automation_key foi criado inline em 20260821020210_automations.sql
-- e reescrito em automations_v2; precisa aceitar a chave nova.
do $$
declare cname text;
begin
  select conname into cname from pg_constraint
   where conrelid = 'public.automation_configs'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%automation_key%';
  if cname is not null then
    execute format('alter table public.automation_configs drop constraint %I', cname);
  end if;
end$$;

alter table public.automation_configs
  add constraint automation_configs_automation_key_check
  check (automation_key in ('relatorio_trafego_semanal','provisionar_card_metricas','coleta_metrica_cliente'));
