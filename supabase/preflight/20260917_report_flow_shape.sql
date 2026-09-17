-- Read-only shape audit for the report workflow. Returns identifiers and
-- classifications only; no payload bodies, comments, files or credentials.
select jsonb_build_object(
  'parents', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', parent.id,
      'client', client.name,
      'title', parent.title,
      'kind', parent.kind,
      'subtype', parent.subtype,
      'status', parent.status,
      'due_date', parent.due_date,
      'recurrence_parent_id', parent.payload->>'recurrence_parent_id'
    ) order by parent.due_date, client.name)
    from public.tasks parent
    left join public.clients client on client.id = parent.client_id
    where parent.payload->>'automation_flow' = 'report_conversion'
  ), '[]'::jsonb),
  'steps', coalesce((
    select jsonb_agg(jsonb_build_object(
      'parent_id', link.parent_id,
      'child_id', child.id,
      'slot', link.slot,
      'kind', child.kind,
      'subtype', child.subtype,
      'status', child.status,
      'due_date', child.due_date,
      'documents', (select count(*) from public.documents document where document.task_id = child.id)
    ) order by link.parent_id, link.position)
    from public.task_links link
    join public.tasks parent on parent.id = link.parent_id
    join public.tasks child on child.id = link.child_id
    where parent.payload->>'automation_flow' = 'report_conversion'
      and link.relation_kind = 'workflow_step'
  ), '[]'::jsonb),
  'configured_clients', coalesce((
    select jsonb_agg(jsonb_build_object(
      'config_id', config.id,
      'automation_key', config.automation_key,
      'client', client.name,
      'target_id', target.id,
      'target_kind', target.kind,
      'target_subtype', target.subtype,
      'target_due_date', target.due_date,
      'depends_on_config_id', config.depends_on_config_id
    ) order by client.name, config.automation_key)
    from public.automation_configs config
    join public.tasks target on target.id = config.target_task_id
    left join public.clients client on client.id = target.client_id
    where config.active
      and config.automation_key in ('relatorio_trafego_semanal', 'relatorio_vendas')
  ), '[]'::jsonb),
  'client_name_candidates', coalesce((
    select jsonb_agg(jsonb_build_object('name', name, 'slug', slug) order by name)
    from public.clients
    where lower(name) like '%karp%'
       or lower(name) like '%baita%'
  ), '[]'::jsonb)
) as report_flow_shape;
