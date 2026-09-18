-- Read-only confirmation that delivery variants resolve through the Entrega root.
select
  variant.id,
  variant.key as variant_key,
  root.key as structural_root,
  version.id as workflow_version_id,
  version.status,
  version.label,
  count(step.id) as step_count
from public.task_types variant
join public.task_types root on root.id = variant.parent_id
left join public.workflow_versions version on version.delivery_type_id = variant.id
left join public.workflow_version_steps step on step.workflow_version_id = version.id
where root.key = 'entrega'
group by variant.id, variant.key, root.key, version.id, version.status, version.label
order by variant.key, version.version;
