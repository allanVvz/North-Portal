-- Decisões de revisão atômicas e trilha estruturada, preservando comentários
-- existentes no payload. Aplicação controlada por runner versionado.
begin;

alter table public.tasks
  add column north_ai_responsible boolean not null default false,
  add column north_ai_reviewer boolean not null default false;

create table public.task_activity_events (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  event_type text not null check (event_type in ('moved_to_review','review_approved','review_changes_requested')),
  actor_id uuid references public.profiles(id) on delete set null,
  actor_kind text not null check (actor_kind in ('human','north_ai','system')),
  body text,
  request_id uuid,
  delivery_id uuid references public.tasks(id) on delete cascade,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  constraint task_activity_event_request_unique unique (task_id, request_id)
);
alter table public.task_activity_events enable row level security;
revoke all on public.task_activity_events from anon, authenticated;
grant select, insert, update, delete on public.task_activity_events to service_role;
create index task_activity_events_task_created_idx
  on public.task_activity_events(task_id, created_at, id);

create or replace function public.notify_review_entry(p_task_id uuid,p_notify_reviewers boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare
  task_row public.tasks;
  reviewers uuid[];
  assignment_required boolean;
begin
  select * into task_row from public.tasks where id=p_task_id;
  if not found then return; end if;
  select coalesce(array_agg(distinct ids.profile_id), '{}'::uuid[]) into reviewers
    from (
      select task_row.reviewer_id as profile_id
      union all
      select value::uuid from jsonb_array_elements_text(
        case when jsonb_typeof(task_row.payload->'reviewer_ids')='array' then task_row.payload->'reviewer_ids' else '[]'::jsonb end
      ) where value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ) ids where ids.profile_id is not null;
  assignment_required := cardinality(reviewers)=0
    and not (task_row.north_ai_responsible and task_row.north_ai_reviewer);
  if cardinality(reviewers)>0 and p_notify_reviewers then
    insert into public.notifications(profile_id,task_id,type,message)
    select reviewer_id,p_task_id,'task_review_assigned','Revisão atribuída: "'||task_row.title||'".'
      from unnest(reviewers) as reviewer_id;
  elsif assignment_required then
    insert into public.notifications(profile_id,task_id,type,message)
    select p.id,p_task_id,'task_review_assigned','Atribua um revisor para "'||task_row.title||'".'
      from public.profiles p where p.role='admin';
  end if;
end $$;
revoke all on function public.notify_review_entry(uuid,boolean) from public, anon, authenticated;

create or replace function public.capture_task_entered_review()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  old_status public.task_status;
begin
  if tg_op='UPDATE' then old_status := old.status; else old_status := null; end if;
  if ((old_status='revisao' and new.status is distinct from old_status)
      or (new.status='aprovado' and old_status is distinct from 'aprovacao'::public.task_status
          and (new.requires_review or new.reviewer_id is not null
          or (jsonb_typeof(new.payload->'reviewer_ids')='array' and jsonb_array_length(new.payload->'reviewer_ids')>0))))
     and coalesce(current_setting('north.review_decision',true),'') <> 'true' then
    raise exception 'Review status may change only through a review decision' using errcode='42501';
  end if;
  if new.status = 'revisao' and old_status is distinct from new.status then
    insert into public.task_activity_events(task_id,event_type,actor_id,actor_kind,body)
    values (new.id,'moved_to_review',auth.uid(),case when auth.uid() is null then 'system' else 'human' end,'Movido para revisão');
    perform public.notify_review_entry(new.id,tg_op='INSERT');
  end if;
  return new;
end $$;
revoke all on function public.capture_task_entered_review() from public, anon, authenticated;
drop trigger if exists capture_task_entered_review on public.tasks;
create trigger capture_task_entered_review after insert or update of status on public.tasks
for each row execute function public.capture_task_entered_review();

create or replace function public.capture_link_entered_review()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  old_effective public.task_status;
  new_effective public.task_status;
  child public.tasks;
begin
  if new.relation_kind <> 'workflow_step' then return new; end if;
  select * into child from public.tasks t where t.id=new.child_id;
  if tg_op='INSERT' then
    old_effective := null;
  else
    old_effective := coalesce(old.status_override,child.status);
  end if;
  new_effective := coalesce(new.status_override,child.status);
  if ((tg_op='UPDATE' and old_effective='revisao' and new_effective is distinct from old_effective)
      or (new_effective='aprovado' and old_effective is distinct from 'aprovacao'::public.task_status
          and (child.requires_review or child.reviewer_id is not null
          or (jsonb_typeof(child.payload->'reviewer_ids')='array' and jsonb_array_length(child.payload->'reviewer_ids')>0))))
     and coalesce(current_setting('north.review_decision',true),'') <> 'true' then
    raise exception 'Review stage may change only through a review decision' using errcode='42501';
  end if;
  -- Creating the link does not constitute a second review entry when the
  -- stage simply inherits a task that was already in Revisão. An explicit
  -- review override still enters this delivery context and gets its own event.
  if new_effective='revisao' and old_effective is distinct from new_effective
     and not (tg_op='INSERT' and new.status_override is null and child.status='revisao') then
    insert into public.task_activity_events(task_id,event_type,actor_id,actor_kind,body,delivery_id)
    values(new.child_id,'moved_to_review',auth.uid(),case when auth.uid() is null then 'system' else 'human' end,'Movido para revisão',new.parent_id);
    perform public.notify_review_entry(new.child_id,true);
  end if;
  return new;
end $$;
revoke all on function public.capture_link_entered_review() from public, anon, authenticated;
drop trigger if exists capture_link_entered_review on public.task_links;
create trigger capture_link_entered_review after insert or update of status_override on public.task_links
for each row execute function public.capture_link_entered_review();

create or replace function public.decide_task_review(
  p_task_id uuid,
  p_actor_id uuid,
  p_decision text,
  p_justification text default null,
  p_expected_status public.task_status default 'revisao',
  p_request_id uuid default null,
  p_delivery_id uuid default null,
  p_actor_kind text default 'human'
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_task public.tasks;
  v_link public.task_links;
  v_status public.task_status;
  v_target public.task_status;
  v_event public.task_activity_events;
  v_allowed boolean := false;
  v_reviewers jsonb;
begin
  if p_task_id is null or p_request_id is null or p_decision not in ('approve','request_changes') then
    raise exception 'Invalid review decision request' using errcode='22023';
  end if;
  if p_actor_kind not in ('human','north_ai') then
    raise exception 'Invalid review actor' using errcode='22023';
  end if;
  if p_justification is not null and length(p_justification) > 4000 then
    raise exception 'Justification is too long' using errcode='22023';
  end if;
  select * into v_task from public.tasks where id=p_task_id for update;
  if not found then raise exception 'Task not found' using errcode='P0002'; end if;
  if p_delivery_id is null and exists (select 1 from public.task_links
       where child_id=p_task_id and relation_kind='workflow_step') then
    raise exception 'Choose the Delivery whose stage is being reviewed' using errcode='22023';
  end if;
  if p_delivery_id is not null then
    select * into v_link from public.task_links
      where parent_id=p_delivery_id and child_id=p_task_id and relation_kind='workflow_step' for update;
    if not found then raise exception 'Delivery stage link changed' using errcode='P0002'; end if;
  end if;
  select * into v_event from public.task_activity_events where task_id=p_task_id and request_id=p_request_id;
  if found then
    if v_event.actor_id is distinct from p_actor_id or v_event.event_type <> (case when p_decision='approve' then 'review_approved' else 'review_changes_requested' end)
      or v_event.delivery_id is distinct from p_delivery_id then
      raise exception 'Request id already used for another decision' using errcode='23505';
    end if;
    return jsonb_build_object('task',to_jsonb(v_task),'effective_status',
      case when p_delivery_id is null then v_task.status else coalesce(v_link.status_override,v_task.status) end,
      'decision',p_decision,'event_id',v_event.id,'replayed',true);
  end if;
  if p_delivery_id is null then
    v_status := v_task.status;
  else
    v_status := coalesce(v_link.status_override,v_task.status);
  end if;
  if v_status is distinct from p_expected_status or v_status <> 'revisao' then
    raise exception 'Review status changed; reload the card' using errcode='40001';
  end if;
  v_reviewers := coalesce(v_task.payload->'reviewer_ids','[]'::jsonb);
  v_allowed := p_actor_kind='human' and p_actor_id is not null and
    (v_task.reviewer_id=p_actor_id or v_reviewers @> jsonb_build_array(p_actor_id::text));
  if p_actor_kind='north_ai' then
    v_allowed := v_task.north_ai_responsible and v_task.north_ai_reviewer
      and v_task.reviewer_id is null and jsonb_typeof(v_reviewers)='array'
      and jsonb_array_length(v_reviewers)=0;
  end if;
  if not v_allowed then raise exception 'Actor is not an assigned reviewer' using errcode='42501'; end if;
  v_target := case when p_decision='approve' then 'aprovado'::public.task_status else 'em_producao'::public.task_status end;
  perform pg_catalog.set_config('north.review_decision','true',true);
  if p_delivery_id is null then
    update public.tasks set status=v_target where id=p_task_id;
  else
    update public.task_links set status_override=v_target,
      completed_at_override=case when v_target='aprovado' then clock_timestamp() else null end,
      paused_from_status=null where parent_id=p_delivery_id and child_id=p_task_id and relation_kind='workflow_step';
  end if;
  insert into public.task_activity_events(task_id,event_type,actor_id,actor_kind,body,request_id,delivery_id)
  values (p_task_id,case when p_decision='approve' then 'review_approved' else 'review_changes_requested' end,
    p_actor_id,p_actor_kind,nullif(btrim(p_justification),''),p_request_id,p_delivery_id)
  returning * into v_event;
  select * into v_task from public.tasks where id=p_task_id;
  return jsonb_build_object('task',to_jsonb(v_task),'effective_status',v_target,
    'decision',p_decision,'event_id',v_event.id,'replayed',false);
end $$;
revoke all on function public.decide_task_review(uuid,uuid,text,text,public.task_status,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.decide_task_review(uuid,uuid,text,text,public.task_status,uuid,uuid,text) to service_role;

commit;
