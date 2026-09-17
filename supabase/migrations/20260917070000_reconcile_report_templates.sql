-- A report automation targets a recurring Task template.  The dated
-- occurrence produced by the automation is the Delivery, not its template.
--
-- `20260916190000_relatorio_entrega_northia.sql` promoted both layers to
-- `criativo`.  That made the Operations UI render the template itself as an
-- Entrega, even though `ensureFlowOccurrence()` materializes the actual
-- report Delivery per cycle.  Restrict this repair to live report automation
-- targets; completed occurrences, documents and workflow steps are history
-- and must remain untouched.

do $$
begin
  -- An active report configuration is only valid over a recurring template.
  -- Fail loudly instead of converting an arbitrary regular Delivery should a
  -- future configuration be malformed.
  if exists (
    select 1
    from public.automation_configs ac
    join public.tasks t on t.id = ac.target_task_id
    where ac.active
      and ac.automation_key in ('relatorio_trafego_semanal', 'relatorio_vendas')
      and (
        t.recurrence_cadence is null
        or coalesce(t.payload ->> 'flow_parent', 'false') = 'true'
      )
  ) then
    raise exception 'Active report automation target must be a recurring non-flow template';
  end if;

  update public.tasks t
     set kind = 'operacional',
         subtype = null
   where exists (
     select 1
     from public.automation_configs ac
     where ac.target_task_id = t.id
       and ac.active
       and ac.automation_key in ('relatorio_trafego_semanal', 'relatorio_vendas')
   )
     and t.recurrence_cadence is not null
     and coalesce(t.payload ->> 'flow_parent', 'false') <> 'true';

  if exists (
    select 1
    from public.automation_configs ac
    join public.tasks t on t.id = ac.target_task_id
    where ac.active
      and ac.automation_key in ('relatorio_trafego_semanal', 'relatorio_vendas')
      and (t.kind <> 'operacional' or t.subtype is not null)
  ) then
    raise exception 'Report template reconciliation left an invalid task classification';
  end if;
end;
$$;
