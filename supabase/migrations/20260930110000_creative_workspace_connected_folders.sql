-- Pastas CONECTADAS (30/09). Uma Entrega legada pode entrar na automação
-- usando pastas que já existem no Drive (ex.: "Evento Baita 10/10 —
-- Carrossel": finais em "Def/Feed", Preview e Raw do evento, da Ali), em vez
-- das que a automação criaria. Com a marca, a preparação não cria, não move e
-- não renomeia nada: só confere que as três pastas existem. Sincronização,
-- uploads e versões já trabalham só pelos ids.
alter table public.drive_creative_workspaces
  add column if not exists connected_folders boolean not null default false;

comment on column public.drive_creative_workspaces.connected_folders is
  'Pastas existentes ligadas à mão: a preparação só confere, nunca cria, move ou renomeia.';
