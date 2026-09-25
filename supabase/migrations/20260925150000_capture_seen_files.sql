-- Arquivos já vistos nas pastas Roteiro e Captação da diária (25/09).
--
-- Regra "arquivo novo na Home da etapa → Revisão" (lib/flows/homeArrival.ts).
-- A Edição tem registro próprio de arquivos (drive_assets); as pastas da diária
-- não têm, então aqui fica só a lista de ids que a sincronização já viu. Ela é
-- o que separa "arquivo novo" de "arquivo que já estava lá" e impede o loop
-- Revisão → Em produção → Revisão com os mesmos arquivos.
--
-- Nula = pasta nunca lida: a primeira leitura só grava a linha de base, sem
-- mudar status, para o deploy não empurrar para Revisão toda diária que já
-- tem arquivo.

alter table public.drive_capture_workspaces
  add column if not exists script_seen_file_ids text[],
  add column if not exists capture_seen_file_ids text[];
