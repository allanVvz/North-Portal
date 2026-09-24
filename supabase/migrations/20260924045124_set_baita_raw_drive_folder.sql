-- Registra a pasta canônica de brutos BAITA já verificada no Google Drive.
-- A alteração é restrita ao cliente BAITA e não move nem apaga itens do Drive.
begin;

do $$
declare
  target_client constant uuid := '4f2bfda6-325d-4da3-94ff-c64802e1e2a4';
  target_folder constant text := '1WFDcGa7XHlV8Nj4Ja3GeHTzJZc7D242W';
  target_url constant text := 'https://drive.google.com/drive/folders/1WFDcGa7XHlV8Nj4Ja3GeHTzJZc7D242W';
  matching_rows integer;
begin
  select count(*) into matching_rows
  from public.client_drive_links
  where client_id = target_client
    and uploads_folder_id = '10yfhwlbsCrBsINQWqMvmYmrfm-eYe3qZ';

  if matching_rows <> 1 then
    raise exception 'Esperava uma linha client_drive_links BAITA com a pasta EDIÇÃO já confirmada; encontrei %.', matching_rows;
  end if;

  if exists (
    select 1 from public.client_drive_links
    where client_id = target_client
      and ((raw_folder_id is not null and raw_folder_id <> target_folder)
        or (raw_url is not null and raw_url <> target_url))
  ) then
    raise exception 'BAITA já possui uma pasta canônica de brutos diferente; nenhuma alteração aplicada.';
  end if;

  update public.client_drive_links
  set raw_folder_id = target_folder,
      raw_url = target_url
  where client_id = target_client;
end;
$$;

commit;
