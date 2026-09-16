-- Relatórios são Entregas classificadas como "Relatório"; não são um tipo-pai
-- paralelo. Mantém os PDFs e comentários já produzidos, mas prepara os ciclos
-- seguintes para Tráfego → Feedback → Conversão.
do $$
declare
  luiza uuid;
  parent_row record;
  feedback_row record;
  conversion_id uuid;
begin
  insert into public.task_types(parent_id, key, label, order_index, behavior, creatable, active, lead_days, progress_weight, default_assignee, client_visible)
  select id, 'conversao', 'Relatório de conversão', 92, 'simples', false, true, 0, 1, null, false
    from public.task_types where key = 'operacional' and parent_id is null
  on conflict (parent_id, key) do nothing;

  select id into luiza from public.profiles where full_name = 'Luiza' and role = 'admin' limit 1;
  if luiza is null then
    raise exception 'Perfil administrativo Luiza não encontrado';
  end if;

  -- O molde é quem transmite Luiza para a ocorrência e suas etapas.
  update public.tasks t
     set kind = 'criativo', subtype = null, reviewer_id = luiza,
         requires_review = true, assignee = 'Northia, Luiza',
         payload = t.payload || jsonb_build_object('formato', 'Relatório')
   where t.id in (
     select target_task_id from public.automation_configs
      where automation_key in ('relatorio_trafego_semanal', 'relatorio_vendas') and active
   );

  for parent_row in
    select t.* from public.tasks t
     where coalesce(t.payload->>'flow_parent', 'false') = 'true'
       and (t.kind = 'relatorio_conversao' or t.payload->>'automation_flow' = 'report_conversion')
  loop
    -- flow_total_weight/flow_step_count nasceram em 2 (trafego+feedback, no
    -- desenho antigo). O desenho novo soma 3 etapas reais (trafego, feedback,
    -- conversao); sem corrigir o congelado, a barra bateria 100% cedo demais.
    update public.tasks
       set kind = 'criativo', subtype = null, reviewer_id = luiza,
           requires_review = true, assignee = 'Northia, Luiza',
           payload = payload || jsonb_build_object(
             'formato','Relatório','automation_flow','report_conversion','automation_actor','Northia',
             'flow_total_weight',3,'flow_step_count',3
           )
     where id = parent_row.id;
    insert into public.task_assignees(task_id, profile_id) values (parent_row.id, luiza)
      on conflict do nothing;

    -- O antigo Feedback acumulava o PDF de vendas. Preserve-o como coleta e
    -- materialize a etapa Conversão com os mesmos artefatos.
    select t.* into feedback_row from public.task_links l join public.tasks t on t.id = l.child_id
     where l.parent_id = parent_row.id and l.slot = 'feedback' limit 1;
    if feedback_row.id is not null and not exists (
      select 1 from public.task_links where parent_id = parent_row.id and slot = 'conversao'
    ) then
      conversion_id := gen_random_uuid();
      insert into public.tasks (
        id, client_id, title, status, priority, assignee, reviewer_id, kind, subtype,
        plan_id, requires_review, requires_approval, due_date, start_date, progress_weight,
        client_visible, payload
      ) values (
        conversion_id, feedback_row.client_id, 'Relatório de conversão', 'revisao',
        feedback_row.priority, 'North ai', luiza, 'operacional', 'conversao', null,
        true, false, feedback_row.due_date, feedback_row.start_date, 1, false,
        jsonb_build_object('migrated_from_feedback', feedback_row.id)
      );
      insert into public.task_links(parent_id, child_id, slot, position)
        values (parent_row.id, conversion_id, 'conversao', 30);
      update public.documents set task_id = conversion_id
       where task_id = feedback_row.id and name like 'relatorio-vendas-%';
      update public.tasks set status = 'aprovado', reviewer_id = luiza,
        requires_review = false, assignee = 'Luiza'
       where id = feedback_row.id;
      delete from public.task_assignees where task_id = feedback_row.id;
      insert into public.task_assignees(task_id, profile_id) values (feedback_row.id, luiza)
        on conflict do nothing;
    end if;
  end loop;
end $$;
