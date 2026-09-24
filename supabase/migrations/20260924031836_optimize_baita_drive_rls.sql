begin;

drop policy if exists "drive creative workspaces admin" on public.drive_creative_workspaces;
drop policy if exists "drive creative workspaces client read" on public.drive_creative_workspaces;
create policy "drive creative workspaces read" on public.drive_creative_workspaces
  for select to authenticated using (
    (select public.is_admin()) or (
      client_id = (select public.current_client_id())
      and exists (
        select 1 from public.tasks t
        where t.id = drive_creative_workspaces.creative_task_id
          and t.client_id = (select public.current_client_id())
          and (t.client_visible or t.status in ('aprovacao', 'aprovado'))
      )
    )
  );
create policy "drive creative workspaces admin insert" on public.drive_creative_workspaces
  for insert to authenticated with check ((select public.is_admin()));
create policy "drive creative workspaces admin update" on public.drive_creative_workspaces
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "drive creative workspaces admin delete" on public.drive_creative_workspaces
  for delete to authenticated using ((select public.is_admin()));

drop policy if exists "drive assets admin" on public.drive_assets;
drop policy if exists "drive assets client read" on public.drive_assets;
create policy "drive assets read" on public.drive_assets
  for select to authenticated using (
    (select public.is_admin()) or (
      state = 'active' and role in ('preview', 'final')
      and exists (
        select 1 from public.drive_creative_workspaces w
        join public.tasks t on t.id = w.creative_task_id
        where w.id = drive_assets.workspace_id
          and w.client_id = (select public.current_client_id())
          and t.client_id = (select public.current_client_id())
          and (t.client_visible or t.status in ('aprovacao', 'aprovado'))
      )
    )
  );
create policy "drive assets admin insert" on public.drive_assets
  for insert to authenticated with check ((select public.is_admin()));
create policy "drive assets admin update" on public.drive_assets
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "drive assets admin delete" on public.drive_assets
  for delete to authenticated using ((select public.is_admin()));

drop policy if exists "drive final versions admin" on public.drive_final_versions;
drop policy if exists "drive final versions client read" on public.drive_final_versions;
create policy "drive final versions read" on public.drive_final_versions
  for select to authenticated using (
    (select public.is_admin()) or (
      state <> 'trashed' and exists (
        select 1 from public.drive_creative_workspaces w
        join public.tasks t on t.id = w.creative_task_id
        where w.id = drive_final_versions.workspace_id
          and w.client_id = (select public.current_client_id())
          and t.client_id = (select public.current_client_id())
          and (t.client_visible or t.status in ('aprovacao', 'aprovado'))
      )
    )
  );
create policy "drive final versions admin insert" on public.drive_final_versions
  for insert to authenticated with check ((select public.is_admin()));
create policy "drive final versions admin update" on public.drive_final_versions
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "drive final versions admin delete" on public.drive_final_versions
  for delete to authenticated using ((select public.is_admin()));

commit;
