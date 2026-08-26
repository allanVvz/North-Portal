-- Marca quais checkpoints comerciais são obrigatórios em todo cliente.
-- No cadastro (Figma 297:2) os obrigatórios aparecem como chips fixos, sem ✕;
-- só "Kickoff e onboarding" pode ser desmarcado. O enforcement real está em
-- provisionCheckpointsForClient (lib/supabase.ts), que sempre inclui os
-- required=true mesmo que o cliente não os mande no payload.

alter table public.commercial_checkpoint_templates
  add column if not exists required boolean not null default true;

update public.commercial_checkpoint_templates
  set required = false
  where title = 'Kickoff e onboarding';
