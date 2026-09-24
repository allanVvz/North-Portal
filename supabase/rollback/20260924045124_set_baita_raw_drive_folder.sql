-- Rollback reversível do vínculo no cadastro: não apaga pastas/arquivos do Drive.
begin;
update public.client_drive_links
set raw_folder_id = null,
    raw_url = null
where client_id = '4f2bfda6-325d-4da3-94ff-c64802e1e2a4'
  and raw_folder_id = '1WFDcGa7XHlV8Nj4Ja3GeHTzJZc7D242W'
  and raw_url = 'https://drive.google.com/drive/folders/1WFDcGa7XHlV8Nj4Ja3GeHTzJZc7D242W';
commit;
