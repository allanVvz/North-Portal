select jsonb_pretty(jsonb_build_object(
  'matching_rows', (select count(*) from public.client_drive_links where client_id='4f2bfda6-325d-4da3-94ff-c64802e1e2a4' and uploads_folder_id='10yfhwlbsCrBsINQWqMvmYmrfm-eYe3qZ' and raw_folder_id='1WFDcGa7XHlV8Nj4Ja3GeHTzJZc7D242W' and raw_url='https://drive.google.com/drive/folders/1WFDcGa7XHlV8Nj4Ja3GeHTzJZc7D242W'),
  'raw_folder_id', (select raw_folder_id from public.client_drive_links where client_id='4f2bfda6-325d-4da3-94ff-c64802e1e2a4'),
  'raw_url', (select raw_url from public.client_drive_links where client_id='4f2bfda6-325d-4da3-94ff-c64802e1e2a4'),
  'creative_count', (select count(*) from public.tasks t join public.task_links l on l.child_id=t.id where l.parent_id='7e1a162d-ff0f-414e-ad50-bea8b472fbcd' and l.relation_kind='structural_member' and t.kind='criativo' and t.subtype is null),
  'capture_groups', (select count(distinct l.child_id) from public.tasks t join public.task_links plan_link on plan_link.child_id=t.id join public.task_links l on l.parent_id=t.id and l.relation_kind='workflow_step' and l.slot='captacao' where plan_link.parent_id='7e1a162d-ff0f-414e-ad50-bea8b472fbcd' and plan_link.relation_kind='structural_member' and t.kind='criativo' and t.subtype is null)
)) as postflight;
