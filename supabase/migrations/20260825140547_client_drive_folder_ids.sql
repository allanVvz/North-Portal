-- IDs reais das pastas do Google Drive criadas pela automação do cadastro
-- (lib/googleDrive.ts). As colunas *_url continuam sendo a fonte do link
-- exibido/editável — inclusive para clientes cuja pasta foi colada à mão.
-- Os *_folder_id existem para (a) re-sincronizar sem reparsear URL e
-- (b) listar os arquivos da pasta no preview do admin.
-- drive_synced_at nulo = nunca provisionado pela automação (vínculo manual).

alter table public.client_drive_links
  add column if not exists root_folder_id text,
  add column if not exists brand_folder_id text,
  add column if not exists products_folder_id text,
  add column if not exists uploads_folder_id text,
  add column if not exists drive_synced_at timestamptz;
