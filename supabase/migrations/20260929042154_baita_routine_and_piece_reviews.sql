-- Baita September/October belongs to Baita and is a member of North's 16/09 cycle.
-- The two shoot days retain one Script and Capture each. Editing is per piece.
-- Rollback: supabase/rollback/20260929042154_baita_routine_and_piece_reviews.sql
begin;

create schema if not exists migration_audit;
revoke all on schema migration_audit from public, anon, authenticated;
create table if not exists migration_audit.baita_routine_20260929 (
  entity text not null,
  entity_id text not null,
  before_row jsonb not null,
  primary key (entity, entity_id)
);
revoke all on migration_audit.baita_routine_20260929 from public, anon, authenticated;

do $$
declare
  target_plan_id constant uuid := '7e1a162d-ff0f-414e-ad50-bea8b472fbcd';
  mold_id constant uuid := '71e87469-990b-416e-9d0e-a6f57e781343';
  cycle_id constant uuid := 'e5f32ccc-154a-4d11-b5dc-1098bec58fcc';
  baita_id constant uuid := '4f2bfda6-325d-4da3-94ff-c64802e1e2a4';
  north_id constant uuid := 'd7cdbac3-775d-457f-b25a-dbf899687853';
  reel_stage constant uuid := '8393b20d-81e3-4b9d-8731-750bc3fb0ae3';
  ads_stage constant uuid := 'd9f87cf5-3437-4797-98cf-44818d03ffa2';
  capture_id constant uuid := '0f18c00f-69b6-4c94-9223-4284fe67dea4';
  luiza constant uuid := 'c87b2f9b-7c23-4539-945a-985ccddfa856';
  cintia constant uuid := 'ab1079a3-6627-4fba-8238-2557243c4fdc';
  item record;
  target_edit_id uuid;
  moved jsonb;
  existing_comments jsonb;
begin
  if not exists (select 1 from public.tasks where id=target_plan_id and client_id=baita_id and kind='plano_acao'
    and plan_id=mold_id and payload->>'recurrence_parent_id'=mold_id::text)
    or not exists (select 1 from public.tasks where id=cycle_id and client_id=north_id
      and payload->>'occurrence_date'='2026-09-16' and plan_id=mold_id)
    or exists (select 1 from migration_audit.baita_routine_20260929) then
    raise exception 'Baita/North preflight changed or migration already applied';
  end if;
  if (select count(*) from public.task_links where child_id=reel_stage and relation_kind='workflow_step') <> 6
    or (select count(*) from public.task_links where child_id=ads_stage and relation_kind='workflow_step') <> 2 then
    raise exception 'Legacy shared Editing links changed';
  end if;

  create temporary table piece_map (
    delivery_id uuid primary key, edit_id uuid not null unique, old_edit_id uuid not null,
    publication_id uuid not null, new_status public.task_status not null
  ) on commit drop;
  insert into piece_map values
    ('08adb443-4d3a-4c38-8b32-be1b27cc111b','b6bf60aa-f1be-57c2-9d33-dd5555cc41d6',reel_stage,'3b7372e1-4359-4ac5-971b-15757838d915','revisao'),
    ('ea692a3d-c5c5-483d-858b-a39fd8f3f228','8ced65fb-c9c5-5c96-a3d4-83c71ec1f5e8',reel_stage,'68bf6f30-8c67-402d-9a6b-48479cc00980','revisao'),
    ('0ab2f61f-ed5b-4e2a-85ec-7dc7353fa12e','a212ac2a-9276-5175-9f10-875666cca625',reel_stage,'1778f2a8-8ac1-4e28-8ef4-2b1f013c457e','revisao'),
    ('b2606f88-b8c7-43c6-a148-df67bc409eaf','d75743aa-b0f4-5625-828b-a8fae1542092',reel_stage,'7938fdf1-6775-48ce-bedb-1a6d9c9eb3cb','revisao'),
    ('ee864705-afbd-4b72-a6df-d7be55046695','bc254f98-0813-52d7-bbcd-d80375ed8879',reel_stage,'79498d2b-f87b-4b99-ac49-141e5207de03','revisao'),
    ('b5a0f9ec-a1a0-480e-ac23-4e2b8978a4a1','614b659a-0183-59e4-a060-3ef2139e58cd',reel_stage,'369ba3c0-20d7-482d-a043-8286123ee698','revisao'),
    ('1f8e78d6-28b2-49ae-8fa9-ceaaaf757eff','b3b56a9a-1fa2-517c-be17-592df5974d05',ads_stage,'fa6e8424-a821-48af-891f-95011fe5bd7e','backlog'),
    ('c1799c11-dba5-41cb-862c-2b5ed1159e00','e0d2e2e7-31eb-55b7-aedf-6621b272fc99',ads_stage,'63dc6a3c-a0e3-458c-9b04-83ff8dfbc67d','backlog');

  if exists (select 1 from piece_map m join public.tasks t on t.id=m.delivery_id
      where t.client_id<>baita_id or t.workflow_version_id is null)
    or exists (select 1 from piece_map m left join public.tasks t on t.id=m.publication_id
      where t.id is null or t.client_id<>baita_id or t.subtype<>'publicacao')
    or exists (select 1 from piece_map m join public.tasks d on d.id=m.delivery_id
      join public.tasks p on p.id=m.publication_id
      left join public.workflow_version_steps s on s.workflow_version_id=d.workflow_version_id and s.step_key='publicacao'
      where s.id is null or p.task_type_id<>s.task_type_id)
    or exists (select 1 from piece_map m join public.tasks t on t.id=m.edit_id)
    or (select count(*) from public.task_links l join piece_map m on m.delivery_id=l.parent_id
      where l.child_id=m.old_edit_id and l.relation_kind='workflow_step' and l.slot='edicao') <> 8 then
    raise exception 'Baita delivery, Publication, or Editing preflight changed';
  end if;

  -- Full before-images are private and permit a precise, guarded rollback.
  insert into migration_audit.baita_routine_20260929
  select 'task',t.id::text,to_jsonb(t) from public.tasks t
  where t.id in (target_plan_id,reel_stage,ads_stage,capture_id,'9c92e5be-fee6-5e65-910a-aed5ee814fc8'::uuid,
    '260a4fc8-b1e2-464a-9f82-c7ded4b17d12'::uuid)
    or t.id in (select delivery_id from piece_map);
  insert into migration_audit.baita_routine_20260929
  select 'link',l.parent_id::text||':'||l.child_id::text,to_jsonb(l) from public.task_links l
  where l.parent_id in (select delivery_id from piece_map) and l.relation_kind='workflow_step' and l.slot='edicao';
  insert into migration_audit.baita_routine_20260929
  select 'workspace',w.creative_task_id::text,to_jsonb(w) from public.drive_creative_workspaces w
  where w.creative_task_id in (select delivery_id from piece_map)
     or w.creative_task_id='260a4fc8-b1e2-464a-9f82-c7ded4b17d12';

  update public.tasks set plan_id=null,
    payload=payload-'recurrence_parent_id'-'occurrence_date'-'recurrence_cycle'-'recurrence_manual_occurrence'
  where id=target_plan_id;
  insert into public.task_links(parent_id,child_id,relation_kind,position)
  values(cycle_id,target_plan_id,'structural_member',0);

  insert into public.tasks(id,client_id,task_type_id,kind,subtype,title,status,priority,assignee,
    reviewer_id,requires_review,due_date,description,client_visible,payload,position,progress_weight,created_by)
  select m.edit_id,old.client_id,old.task_type_id,'operacional','edicao',d.title||' — Edição',
    m.new_status,old.priority,old.assignee,cintia,true,old.due_date,old.description,
    old.client_visible,jsonb_build_object('reviewer_ids',jsonb_build_array(cintia,luiza),
      'legacy_shared_stage_id',m.old_edit_id,'flow_prev_task_id',
      case when m.old_edit_id=reel_stage then capture_id else 'eae097f0-b30e-4a4b-ad36-3a6a8d22d18a'::uuid end),
    old.position,old.progress_weight,old.created_by
  from piece_map m join public.tasks old on old.id=m.old_edit_id join public.tasks d on d.id=m.delivery_id;
  insert into public.task_assignees(task_id,profile_id)
  select m.edit_id,a.profile_id from piece_map m join public.task_assignees a on a.task_id=m.old_edit_id
  on conflict do nothing;

  update public.task_links l set child_id=m.edit_id,status_override=null,completed_at_override=null,paused_from_status=null
  from piece_map m where l.parent_id=m.delivery_id and l.child_id=m.old_edit_id
    and l.relation_kind='workflow_step' and l.slot='edicao';
  update public.drive_creative_workspaces w set stage_task_id=m.edit_id
  from piece_map m where w.creative_task_id=m.delivery_id;
  update public.drive_creative_workspaces set stage_task_id='9c92e5be-fee6-5e65-910a-aed5ee814fc8'
  where creative_task_id='260a4fc8-b1e2-464a-9f82-c7ded4b17d12';

  -- Existing Publication cards are reserved for the next workflow step.
  update public.tasks d set payload=coalesce(d.payload,'{}'::jsonb)
    || jsonb_build_object('prepared_publication_task_id',m.publication_id)
  from piece_map m where d.id=m.delivery_id;
  update public.tasks set payload=coalesce(payload,'{}'::jsonb)
    || jsonb_build_object('reviewer_ids',jsonb_build_array(cintia,luiza))
  where id='9c92e5be-fee6-5e65-910a-aed5ee814fc8';

  -- Move only specifically identified feedback. General status history stays
  -- on the old shared card, with its original author and timestamp.
  for item in select * from (values
    ('1b78b1ca-3101-4868-ac46-dad5fccdf4da','b5a0f9ec-a1a0-480e-ac23-4e2b8978a4a1'::uuid),
    ('bd3bb5c4-56bf-4b29-9756-8fb83a8eac8b','b5a0f9ec-a1a0-480e-ac23-4e2b8978a4a1'::uuid),
    ('9eaf64f2-92b8-4e28-868b-ed40dfff7de0','ea692a3d-c5c5-483d-858b-a39fd8f3f228'::uuid),
    ('27711faf-af48-403d-9296-1a95271599e5','ea692a3d-c5c5-483d-858b-a39fd8f3f228'::uuid),
    ('070011e6-2162-4777-a49b-c81aab5561ea','ee864705-afbd-4b72-a6df-d7be55046695'::uuid),
    ('7eae1b0c-a98d-47b4-a5ef-8c0fa997b4f7','0ab2f61f-ed5b-4e2a-85ec-7dc7353fa12e'::uuid)
  ) as x(comment_id,delivery_id) loop
    select c.value into moved from public.tasks t,
      lateral jsonb_array_elements(coalesce(t.payload->'comments','[]'::jsonb)) c
      where t.id=reel_stage and c.value->>'id'=item.comment_id;
    if moved is null then raise exception 'Review comment % missing',item.comment_id; end if;
    select m.edit_id into target_edit_id from piece_map m where m.delivery_id=item.delivery_id;
    select coalesce(payload->'comments','[]'::jsonb) into existing_comments from public.tasks where id=target_edit_id;
    update public.tasks set payload=jsonb_set(payload,'{comments}',existing_comments||jsonb_build_array(moved),true)
      where id=target_edit_id;
  end loop;
  update public.tasks t set payload=jsonb_set(t.payload,'{comments}',coalesce((
    select jsonb_agg(c.value order by c.ord) from jsonb_array_elements(coalesce(t.payload->'comments','[]'::jsonb))
      with ordinality c(value,ord) where c.value->>'id' not in
      ('1b78b1ca-3101-4868-ac46-dad5fccdf4da','bd3bb5c4-56bf-4b29-9756-8fb83a8eac8b',
       '9eaf64f2-92b8-4e28-868b-ed40dfff7de0','27711faf-af48-403d-9296-1a95271599e5',
       '070011e6-2162-4777-a49b-c81aab5561ea','7eae1b0c-a98d-47b4-a5ef-8c0fa997b4f7')
  ),'[]'::jsonb),true) where id=reel_stage;
  -- Historical containers remain addressable by ID, outside operational views.
  update public.tasks set payload=coalesce(payload,'{}'::jsonb)
    || '{"legacy_shared_stage_archived":true}'::jsonb where id in (reel_stage,ads_stage);

  -- Consolidate the automatic raw-file burst. The Drive files and their
  -- per-workspace links remain untouched; only their noisy timeline changes.
  update public.tasks t set payload=jsonb_set(t.payload,'{comments}',
    coalesce((select jsonb_agg(c.value order by c.ord)
      from jsonb_array_elements(coalesce(t.payload->'comments','[]'::jsonb)) with ordinality c(value,ord)
      where c.value->>'id' not like 'home-arrival:%'),'[]'::jsonb)
    || jsonb_build_array(jsonb_build_object('id','baita-capture-1609-raw-summary',
      'at','2026-09-29T02:03:36.039Z','author','North AI',
      'text','🎬 Brutos da diária 16/09: 133 MOV e 61 HEIC originais preservados. [Abrir pasta da Captação](https://drive.google.com/drive/folders/1YLUcItepsBnEvqQ0XrsVyGcHhC3vvcx6).')),true)
  where id=capture_id;
end $$;

-- A recurrence execution can never be reassigned across clients, even when a
-- caller bypasses the admin HTTP route and writes directly to tasks.
create or replace function public.validate_recurrence_client()
returns trigger language plpgsql set search_path='' as $$
declare parent_client uuid; recurrence_parent text;
begin
  recurrence_parent := new.payload->>'recurrence_parent_id';
  if new.plan_id is not null then
    select client_id into parent_client from public.tasks where id=new.plan_id;
    if parent_client is null or parent_client is distinct from new.client_id then
      raise exception 'A recurrence execution must belong to the same client as its template' using errcode='23514';
    end if;
  end if;
  if recurrence_parent is not null and recurrence_parent <> '' then
    if new.plan_id is null or recurrence_parent <> new.plan_id::text then
      raise exception 'A recurrence execution must point to its template' using errcode='23514';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists tasks_validate_recurrence_client on public.tasks;
create trigger tasks_validate_recurrence_client before insert or update of client_id,plan_id,payload
on public.tasks for each row execute function public.validate_recurrence_client();

-- Both reviewers receive future review assignments. Inserts in the historical
-- reorganization do not send notifications.
create or replace function public.notify_additional_task_reviewers()
returns trigger language plpgsql set search_path='' as $$
declare reviewer uuid;
begin
  if new.status='revisao' and (old.status is distinct from new.status
    or old.payload->'reviewer_ids' is distinct from new.payload->'reviewer_ids') then
    for reviewer in select value::uuid from jsonb_array_elements_text(
      case when jsonb_typeof(new.payload->'reviewer_ids')='array' then new.payload->'reviewer_ids' else '[]'::jsonb end
    ) loop
      if reviewer is distinct from new.reviewer_id then
        insert into public.notifications(profile_id,task_id,type,message)
        values(reviewer,new.id,'task_review_assigned','Revisão atribuída: "'||new.title||'".');
      end if;
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists notify_additional_task_reviewers on public.tasks;
create trigger notify_additional_task_reviewers after update on public.tasks
for each row execute function public.notify_additional_task_reviewers();

commit;
