-- Rollback operacional e nao destrutivo: interrompe novas mutacoes sem apagar
-- workspaces, assets, atalhos ou arquivos ja criados no Google Drive.
begin;
update public.drive_workspace_plan_allowlist
set enabled = false, updated_at = now()
where plan_task_id = '7e1a162d-ff0f-414e-ad50-bea8b472fbcd';
commit;
