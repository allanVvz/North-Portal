-- Read-only assertions for the Baita/North repair. Run before ledger entry.
do $$
declare
  reel_ids uuid[] := array[
    '08adb443-4d3a-4c38-8b32-be1b27cc111b','ea692a3d-c5c5-483d-858b-a39fd8f3f228',
    '0ab2f61f-ed5b-4e2a-85ec-7dc7353fa12e','b2606f88-b8c7-43c6-a148-df67bc409eaf',
    'ee864705-afbd-4b72-a6df-d7be55046695','b5a0f9ec-a1a0-480e-ac23-4e2b8978a4a1'
  ];
  ad_ids uuid[] := array['1f8e78d6-28b2-49ae-8fa9-ceaaaf757eff','c1799c11-dba5-41cb-862c-2b5ed1159e00'];
begin
  if not exists (select 1 from public.tasks where id='7e1a162d-ff0f-414e-ad50-bea8b472fbcd'
    and client_id='4f2bfda6-325d-4da3-94ff-c64802e1e2a4' and plan_id is null
    and not (payload ? 'recurrence_parent_id'))
    or (select count(*) from public.task_links where parent_id='e5f32ccc-154a-4d11-b5dc-1098bec58fcc'
      and child_id='7e1a162d-ff0f-414e-ad50-bea8b472fbcd' and relation_kind='structural_member')<>1
    or exists (select 1 from public.tasks where id='7e1a162d-ff0f-414e-ad50-bea8b472fbcd'
      and plan_id='71e87469-990b-416e-9d0e-a6f57e781343') then
    raise exception 'Plan ownership or North cycle membership mismatch';
  end if;
  if (select count(*) from public.task_links l join public.tasks e on e.id=l.child_id
      where l.parent_id=any(reel_ids||ad_ids) and l.slot='edicao' and l.relation_kind='workflow_step'
        and e.subtype='edicao' and e.payload ? 'legacy_shared_stage_id'
        and e.reviewer_id='ab1079a3-6627-4fba-8238-2557243c4fdc'
        and e.payload->'reviewer_ids' @> '["c87b2f9b-7c23-4539-945a-985ccddfa856"]'::jsonb)<>8
    or exists (select 1 from public.task_links where child_id in
      ('8393b20d-81e3-4b9d-8731-750bc3fb0ae3','d9f87cf5-3437-4797-98cf-44818d03ffa2')
      and relation_kind='workflow_step')
    or not exists (select 1 from public.tasks where id='9c92e5be-fee6-5e65-910a-aed5ee814fc8'
      and payload->'reviewer_ids' @> '["c87b2f9b-7c23-4539-945a-985ccddfa856"]'::jsonb) then
    raise exception 'Individual Editing links or reviewers mismatch';
  end if;
  if (select count(distinct child_id) from public.task_links where parent_id=any(reel_ids)
      and slot='roteiro')<>1
    or (select count(distinct child_id) from public.task_links where parent_id=any(reel_ids)
      and slot='captacao')<>1
    or (select count(distinct child_id) from public.task_links where parent_id=any(ad_ids)
      and slot='roteiro')<>1
    or (select count(distinct child_id) from public.task_links where parent_id=any(ad_ids)
      and slot='captacao')<>1
    or (select count(*) from public.tasks d join public.tasks p
      on p.id=(d.payload->>'prepared_publication_task_id')::uuid
      where d.id=any(reel_ids||ad_ids) and p.subtype='publicacao' and p.client_id=d.client_id)<>8 then
    raise exception 'Daily shared steps or individual Publication cards mismatch';
  end if;
  if (select count(*) from public.tasks e cross join lateral jsonb_array_elements(coalesce(e.payload->'comments','[]'::jsonb)) c
      where e.payload ? 'legacy_shared_stage_id' and c.value->>'id' in
      ('1b78b1ca-3101-4868-ac46-dad5fccdf4da','bd3bb5c4-56bf-4b29-9756-8fb83a8eac8b',
       '9eaf64f2-92b8-4e28-868b-ed40dfff7de0','27711faf-af48-403d-9296-1a95271599e5',
       '070011e6-2162-4777-a49b-c81aab5561ea','7eae1b0c-a98d-47b4-a5ef-8c0fa997b4f7'))<>6
    or exists (select 1 from public.tasks t cross join lateral jsonb_array_elements(coalesce(t.payload->'comments','[]'::jsonb)) c
      where t.id='8393b20d-81e3-4b9d-8731-750bc3fb0ae3' and c.value->>'id' in
      ('1b78b1ca-3101-4868-ac46-dad5fccdf4da','bd3bb5c4-56bf-4b29-9756-8fb83a8eac8b',
       '9eaf64f2-92b8-4e28-868b-ed40dfff7de0','27711faf-af48-403d-9296-1a95271599e5',
       '070011e6-2162-4777-a49b-c81aab5561ea','7eae1b0c-a98d-47b4-a5ef-8c0fa997b4f7'))
    or exists (select 1 from public.tasks e cross join lateral jsonb_array_elements(coalesce(e.payload->'comments','[]'::jsonb)) c
      where e.payload ? 'legacy_shared_stage_id' and not exists (
        select 1 from migration_audit.baita_routine_20260929 a
        cross join lateral jsonb_array_elements(coalesce(a.before_row->'payload'->'comments','[]'::jsonb)) old_comment
        where a.entity='task' and a.entity_id='8393b20d-81e3-4b9d-8731-750bc3fb0ae3'
          and old_comment.value=c.value)) then
    raise exception 'Review comments changed or misplaced';
  end if;
  if (select count(*) from public.tasks t cross join lateral jsonb_array_elements(coalesce(t.payload->'comments','[]'::jsonb)) c
      where t.id='0f18c00f-69b6-4c94-9223-4284fe67dea4' and c.value->>'id'='baita-capture-1609-raw-summary'
        and c.value->>'author'='North AI' and c.value->>'text' like '%133 MOV%61 HEIC%1YLUcItepsBnEvqQ0XrsVyGcHhC3vvcx6%')<>1
    or exists (select 1 from public.tasks t cross join lateral jsonb_array_elements(coalesce(t.payload->'comments','[]'::jsonb)) c
      where t.id='0f18c00f-69b6-4c94-9223-4284fe67dea4' and c.value->>'id' like 'home-arrival:%')
    or not exists (select 1 from public.drive_capture_workspaces
      where capture_task_id='0f18c00f-69b6-4c94-9223-4284fe67dea4'
        and capture_folder_id='1YLUcItepsBnEvqQ0XrsVyGcHhC3vvcx6')
    or not exists (select 1 from public.drive_capture_workspaces
      where capture_task_id='eae097f0-b30e-4a4b-ad36-3a6a8d22d18a'
        and capture_folder_id='1vYO4NyNP3l9frRqBetTP7Dp1SNjkdyc2') then
    raise exception 'Raw capture summary mismatch';
  end if;
end $$;
